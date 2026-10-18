import { getProviderConnections } from "@/lib/localDb";
import { getUsageStats } from "@/lib/usageDb";
import { GET as getQuota } from "../[connectionId]/route";
import { GET as getCredits } from "../[connectionId]/codex-reset-credits/route";
import { parseQuotaData, getRemainingPercentage } from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils";
import { widgetAccount } from "@/lib/widgetAccount";

export const dynamic = "force-dynamic";
const cache = new Map();
let snapshot;
let snapshotAt = 0;
let pending;

async function accountQuota(connection, request) {
  const previous = cache.get(connection.id);
  const interval = connection.provider === "claude" ? 600000 : 60000;
  if (previous && Date.now() - previous.at < interval) return previous;
  try {
    const context = { params: Promise.resolve({ connectionId: connection.id }) };
    const response = await getQuota(request, context);
    const data = await response.json();
    if (!response.ok || data.error || data.message) throw new Error("Quota unavailable");
    let credits = null;
    if (connection.provider === "codex" && data.resetCredits?.availableCount > 0) {
      try {
        const res = await getCredits(request, context);
        if (res.ok) credits = (await res.json()).credits;
      } catch { /* Count remains available when expiry lookup fails. */ }
    }
    const entry = {
      at: Date.now(), updatedAt: new Date().toISOString(),
      quotas: parseQuotaData(connection.provider, data).map(q => ({
        name: q.name, remaining: getRemainingPercentage(q), resetAt: q.resetAt || null,
      })),
      plan: data.plan || null, resetCredits: data.resetCredits || null, credits,
    };
    cache.set(connection.id, entry);
    return entry;
  } catch {
    const entry = { ...previous, at: Date.now(), error: "Quota unavailable" };
    cache.set(connection.id, entry);
    return entry;
  }
}

async function collect(request) {
  const [connections, stats] = await Promise.all([getProviderConnections(), getUsageStats("all")]);
  const ids = new Set(connections.map(c => c.id));
  for (const id of cache.keys()) if (!ids.has(id)) cache.delete(id);
  const usage = new Map();
  for (const row of Object.values(stats.byAccount || {})) {
    const totals = usage.get(row.connectionId) || { requests: 0, tokens: 0 };
    totals.requests += row.requests || 0;
    totals.tokens += (row.promptTokens || 0) + (row.completionTokens || 0);
    usage.set(row.connectionId, totals);
  }
  const accounts = [];
  // Bound provider traffic and avoid concurrent refreshes from this endpoint.
  for (const connection of connections) {
    accounts.push(widgetAccount(connection, await accountQuota(connection, request), usage.get(connection.id)));
  }
  return { updatedAt: new Date().toISOString(), period: "all", accounts };
}

// Dashboard guard protects this route; no API keys, OAuth tokens or raw payloads leave it.
export async function GET(request) {
  try {
    if (!snapshot || Date.now() - snapshotAt >= 60000) {
      pending ||= collect(request).then(value => {
        snapshot = value;
        snapshotAt = Date.now();
      }).finally(() => { pending = null; });
      await pending;
    }
    return Response.json(snapshot, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Account data unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
