// Reset auto-redeem scheduler: spends a Codex/Claude reset credit in the last minutes
// before it expires, so banked credits are never lost unused. Opt-in (global setting,
// per-connection override in providerSpecificData.autoRedeemResets).
import "open-sse/index.js";

import { getSettings, getProviderConnections } from "@/lib/localDb";
import { getClaudeUsage, consumeClaudeResetGrant } from "open-sse/services/usage/claude.js";
import { getCodexRateLimitResetCredits, consumeCodexRateLimitResetCredit } from "open-sse/services/usage/codex.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { refreshAndUpdateCredentials } from "@/app/api/usage/[connectionId]/route.js";
import { RESET_AUTOREDEEM_CONFIG } from "@/shared/constants/config";

const C = RESET_AUTOREDEEM_CONFIG;
const MAX_ATTEMPTS = 2; // one retry inside the window (e.g. transient auth/network error)
const SPENT_STATUSES = new Set(["used", "consumed", "redeemed", "expired", "revoked"]);

// Survive Next.js hot reload and keep one scheduler per server process.
const g = (global.__resetAutoRedeem ??= {
  interval: null,
  running: false,
  soonest: {},     // connKey -> { id, expiresAt } of the next credit to lapse
  nextPollAt: {},  // connKey -> ms
  attempted: {},   // creditKey -> { at, count } of redeem attempts (capped, never loops)
  failedAt: {},    // connKey -> ms
});

function toMs(value) {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

// Connection override (true/false) wins; otherwise follow the global setting
export function isAutoRedeemEnabled(connection, settings) {
  const override = connection?.providerSpecificData?.autoRedeemResets;
  if (override === true || override === false) return override;
  return settings?.autoRedeemExpiringResets === true;
}

function isEligibleConnection(conn) {
  if (conn.provider === "claude") return conn.authType === "oauth";
  if (conn.provider === "codex") return conn.authType === "oauth" || conn.authType === "access_token";
  return false;
}

function buildProxyOptions(cfg) {
  return {
    connectionProxyEnabled: cfg?.connectionProxyEnabled === true,
    connectionProxyUrl: cfg?.connectionProxyUrl || "",
    connectionNoProxy: cfg?.connectionNoProxy || "",
    vercelRelayUrl: cfg?.vercelRelayUrl || "",
    strictProxy: false,
  };
}

// Soonest-expiring unspent credit, or null. { id, expiresAt }
async function fetchSoonestCredit(connection, proxyOptions, deps, now) {
  if (connection.provider === "codex") {
    const result = await deps.getCodexRateLimitResetCredits(connection.accessToken, proxyOptions, connection.providerSpecificData);
    const live = (result?.credits || [])
      .filter((c) => !SPENT_STATUSES.has(String(c.status).toLowerCase()) && toMs(c.expiresAt) > now)
      .sort((a, b) => toMs(a.expiresAt) - toMs(b.expiresAt));
    // Codex consumes the soonest credit server-side; grantedAt only disambiguates the attempt key
    return live[0] ? { id: live[0].grantedAt || null, expiresAt: live[0].expiresAt } : null;
  }

  const usage = await deps.getClaudeUsage(connection.accessToken, proxyOptions, { force: true });
  const grants = (usage?.resetCredits?.grants || [])
    .filter((gr) => !gr.paused && gr.resetsLeft > 0 && toMs(gr.endsAt) > now)
    .sort((a, b) => toMs(a.endsAt) - toMs(b.endsAt));
  return grants[0] ? { id: grants[0].id, expiresAt: grants[0].endsAt } : null;
}

async function redeemCredit(connection, credit, proxyOptions, deps) {
  if (connection.provider === "codex") {
    const result = await deps.consumeCodexRateLimitResetCredit(connection.accessToken, crypto.randomUUID(), proxyOptions);
    return { ok: result.ok, final: result.noCredit, detail: result.code || result.message || `HTTP ${result.status}` };
  }
  const result = await deps.consumeClaudeResetGrant(connection.accessToken, credit.id, proxyOptions);
  return { ok: result.ok, detail: result.reason || result.result || result.message || `HTTP ${result.status}` };
}

function isExhausted(state, key) {
  return (state.attempted[key]?.count || 0) >= MAX_ATTEMPTS;
}

function creditKey(connKey, credit) {
  return `${connKey}:${credit.id || ""}:${credit.expiresAt}`;
}

function isDue(credit, now) {
  return Boolean(credit) && toMs(credit.expiresAt) - C.leadMs <= now;
}

async function processConnection(conn, deps, state, now) {
  const connKey = `${conn.provider}:${conn.id}`;
  const cached = state.soonest[connKey];

  // Between polls, only wake up when the cached credit enters its redeem window
  const cachedDue = isDue(cached, now) && !isExhausted(state, creditKey(connKey, cached));
  if (!cachedDue && now < (state.nextPollAt[connKey] || 0)) return;
  // Failure backoff applies to background polling only, never to a credit about to lapse
  if (!cachedDue && state.failedAt[connKey] && now - state.failedAt[connKey] < C.failureCooldownMs) return;

  const proxyOptions = buildProxyOptions(await deps.resolveConnectionProxyConfig(conn.providerSpecificData));
  let connection = conn;
  try {
    if (conn.authType === "oauth") {
      ({ connection } = await deps.refreshAndUpdateCredentials(conn, false, proxyOptions));
    }
    // Always confirm against live data before spending anything
    const credit = await fetchSoonestCredit(connection, proxyOptions, deps, now);
    state.soonest[connKey] = credit;
    state.nextPollAt[connKey] = now + C.pollIntervalMs;
    delete state.failedAt[connKey];

    if (!isDue(credit, now)) return;
    const key = creditKey(connKey, credit);
    if (isExhausted(state, key)) return;
    // Mark first: a crashed/failed redeem counts, so it can never loop
    state.attempted[key] = { at: now, count: (state.attempted[key]?.count || 0) + 1 };

    const result = await redeemCredit(connection, credit, proxyOptions, deps);
    if (result.ok || result.final) {
      state.attempted[key].count = MAX_ATTEMPTS;
    }
    if (result.ok) {
      console.log(`[ResetAutoRedeem] ${connKey}: redeemed credit expiring ${credit.expiresAt}`);
    } else {
      console.warn(`[ResetAutoRedeem] ${connKey}: redeem not applied (${result.detail})`);
    }
  } catch (e) {
    state.failedAt[connKey] = now;
    console.warn(`[ResetAutoRedeem] ${connKey}: ${e.message}`);
  }
}

function pruneAttempts(state, now) {
  for (const [key, attempt] of Object.entries(state.attempted)) {
    if (now - attempt.at > C.attemptTtlMs) delete state.attempted[key];
  }
}

function createDefaultDeps() {
  return {
    getSettings,
    getProviderConnections,
    resolveConnectionProxyConfig,
    refreshAndUpdateCredentials,
    getCodexRateLimitResetCredits,
    consumeCodexRateLimitResetCredit,
    getClaudeUsage,
    consumeClaudeResetGrant,
  };
}

export async function runResetAutoRedeemTick(deps = createDefaultDeps(), state = g, now = Date.now()) {
  if (state.running) return;
  state.running = true;
  try {
    pruneAttempts(state, now);
    const settings = await deps.getSettings();
    for (const provider of ["codex", "claude"]) {
      const conns = await deps.getProviderConnections({ provider, isActive: true });
      for (const conn of conns) {
        if (!isEligibleConnection(conn) || !isAutoRedeemEnabled(conn, settings)) continue;
        await processConnection(conn, deps, state, now);
      }
    }
  } catch (e) {
    console.warn("[ResetAutoRedeem] tick error:", e.message);
  } finally {
    state.running = false;
  }
}

export function startResetAutoRedeem() {
  if (g.interval) return;
  console.log("[ResetAutoRedeem] scheduler started");
  runResetAutoRedeemTick().catch(() => {});
  g.interval = setInterval(() => { runResetAutoRedeemTick().catch(() => {}); }, C.tickIntervalMs);
  if (g.interval.unref) g.interval.unref();
}
