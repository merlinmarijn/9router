/**
 * "Most Quota Left" account strategy — codex-lb's deterministic `usage_weighted`.
 *
 * Ranks connections by remaining subscription quota as reported by the
 * provider usage APIs (open-sse/services/usage.js) — the same numbers the
 * Usage dashboard shows: most long-window (weekly/monthly) left first, then
 * most short-window (5h) left, then least recently selected. Unknown usage
 * counts as 100% left (as in codex-lb), so providers without a usage API
 * rotate new sessions across accounts.
 *
 * Selection never waits on the network: it ranks from an in-memory snapshot
 * and kicks a background refresh for stale entries. Tokens are never refreshed
 * here (OpenAI rotates refresh tokens; a parallel refresh can revoke a session),
 * so a fetch that fails just keeps the last snapshot.
 */
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import * as log from "../utils/logger.js";

export const MOST_QUOTA_STRATEGY = "most-quota";

const IDLE_MAX_AGE_MS = 5 * 60 * 1000;     // accounts not currently serving traffic
const ACTIVE_MAX_AGE_MS = 60 * 1000;       // the account just picked (it's the one draining)
const FETCH_TIMEOUT_MS = 10 * 1000;
const LONG_WINDOW_RE = /week|7\s*d|month/i;

// Main pools per provider; anything else (review/spark/per-model pools) is ignored for these.
const PROVIDER_QUOTA_KEYS = {
  codex: { long: ["weekly"], short: ["session"] },
  claude: { long: ["weekly (7d)"], short: ["session (5h)"] },
};

// codex-lb sticky reallocation defaults: move a session off its account once the
// short window is ≥95% used or the long window is fully used.
const SHORT_BUDGET_USED_PCT = 95;
const LONG_BUDGET_USED_PCT = 100;

// connectionId → { score: {long, short} | null, fetchedAt, inFlight }
const cache = new Map();
// connectionId → ms of last selection (tie-break, like codex-lb last_selected_at)
const lastSelected = new Map();

function remainingPercent(quota) {
  if (!quota || typeof quota !== "object") return null;
  if (quota.unlimited === true) return 100;
  const total = Number(quota.total);
  const remaining = Number(quota.remaining);
  if (Number.isFinite(total) && total > 0 && Number.isFinite(remaining)) {
    return Math.max(0, Math.min(100, Math.round((remaining / total) * 10000) / 100));
  }
  const pct = Number(quota.remainingPercentage);
  return Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : null;
}

function minPercent(quotas, names) {
  const values = names.map((n) => remainingPercent(quotas[n])).filter((v) => v !== null);
  return values.length ? Math.min(...values) : null;
}

/**
 * Reduce a usage payload to { long, short } remaining percentages (null = not reported).
 * Generic providers: long = weekly/monthly windows; short = per-model pools matching
 * the requested model if any exist, otherwise every other window.
 */
export function scoreQuotas(providerId, quotas, model = null) {
  if (!quotas || typeof quotas !== "object") return null;
  const names = Object.keys(quotas);
  const known = PROVIDER_QUOTA_KEYS[providerId];
  let longNames, shortNames;
  if (known) {
    longNames = known.long;
    shortNames = known.short;
  } else {
    longNames = names.filter((n) => LONG_WINDOW_RE.test(n));
    const rest = names.filter((n) => !LONG_WINDOW_RE.test(n));
    const lowerModel = model ? String(model).toLowerCase() : null;
    const forModel = lowerModel ? rest.filter((n) => n.toLowerCase().includes(lowerModel)) : [];
    shortNames = forModel.length ? forModel : rest;
  }
  const long = minPercent(quotas, longNames);
  const short = minPercent(quotas, shortNames);
  return long === null && short === null ? null : { long, short };
}

// Most long-window left, then most short-window left, then least recently selected, then priority.
function compare(a, b) {
  const longDiff = (b.score?.long ?? 100) - (a.score?.long ?? 100);
  if (longDiff) return longDiff;
  const shortDiff = (b.score?.short ?? 100) - (a.score?.short ?? 100);
  if (shortDiff) return shortDiff;
  const selectedDiff = (lastSelected.get(a.conn.id) || 0) - (lastSelected.get(b.conn.id) || 0);
  if (selectedDiff) return selectedDiff;
  return (a.conn.priority || 999) - (b.conn.priority || 999);
}

/** True when the account is past codex-lb's sticky budget (≥95% short or 100% long used). */
export function isOverQuotaBudget(connection) {
  const score = connection ? cache.get(connection.id)?.score : null;
  if (!score) return false;
  return (score.short !== null && 100 - score.short >= SHORT_BUDGET_USED_PCT)
    || (score.long !== null && 100 - score.long >= LONG_BUDGET_USED_PCT);
}

async function fetchScore(connection, model) {
  const { getUsageForProvider } = await import("open-sse/services/usage.js");
  const proxy = await resolveConnectionProxyConfig(connection.providerSpecificData || {});
  const proxyOptions = {
    connectionProxyEnabled: proxy.connectionProxyEnabled === true,
    connectionProxyUrl: proxy.connectionProxyUrl || "",
    connectionNoProxy: proxy.connectionNoProxy || "",
    vercelRelayUrl: proxy.vercelRelayUrl || "",
    strictProxy: false,
  };
  const usage = await Promise.race([
    getUsageForProvider(connection, proxyOptions),
    new Promise((_, reject) => setTimeout(() => reject(new Error("usage fetch timeout")), FETCH_TIMEOUT_MS).unref?.()),
  ]);
  return scoreQuotas(connection.provider, usage?.quotas, model);
}

/** Background-refresh one connection's snapshot when older than maxAgeMs. Never throws. */
export function refreshQuotaIfStale(connection, model = null, maxAgeMs = IDLE_MAX_AGE_MS) {
  if (!connection?.id) return null;
  const entry = cache.get(connection.id) || { score: null, fetchedAt: 0, inFlight: null };
  if (entry.inFlight || Date.now() - entry.fetchedAt < maxAgeMs) return entry.inFlight;
  entry.inFlight = fetchScore(connection, model)
    .then((score) => {
      // Keep the previous snapshot when the provider reports nothing usable (e.g. expired token)
      if (score) entry.score = score;
    })
    .catch((error) => {
      log.debug("QUOTA", `${connection.id.slice(0, 8)} usage refresh failed: ${error.message}`);
    })
    .finally(() => {
      entry.fetchedAt = Date.now();
      entry.inFlight = null;
    });
  cache.set(connection.id, entry);
  return entry.inFlight;
}

/** Most-quota-first ordering of candidates; schedules refreshes for stale snapshots. */
export function rankByQuota(connections, model = null) {
  for (const conn of connections) refreshQuotaIfStale(conn, model);
  return connections
    .map((conn) => ({ conn, score: cache.get(conn.id)?.score || null }))
    .sort(compare)
    .map((entry) => entry.conn);
}

/** Pick the connection with the most quota left and keep its snapshot fresh while it drains. */
export function pickByQuota(connections, model = null) {
  const connection = rankByQuota(connections, model)[0];
  noteQuotaActivity(connection, model);
  return connection;
}

/** The account serving traffic is the one whose numbers move; refresh it more often. */
export function noteQuotaActivity(connection, model = null) {
  if (!connection?.id) return;
  lastSelected.set(connection.id, Date.now());
  refreshQuotaIfStale(connection, model, ACTIVE_MAX_AGE_MS);
}

/** Test/maintenance hook: seed or clear snapshots. */
export function setQuotaSnapshot(connectionId, score, fetchedAt = Date.now()) {
  cache.set(connectionId, { score, fetchedAt, inFlight: null });
}

export function clearQuotaSnapshots() {
  cache.clear();
  lastSelected.clear();
}
