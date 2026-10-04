"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AI_PROVIDERS } from "@/shared/constants/providers";
import KpiTile from "./KpiTile";
import DonutCard from "./DonutCard";
import AccountCard, { getAccountState } from "./AccountCard";
import RequestLogTable from "./RequestLogTable";
import {
  PERIOD_OPTIONS,
  formatCompact,
  formatCost,
  formatPercent,
  getPeriodDays,
} from "./format";
import {
  getQuotaCache,
  parseQuotaData,
  setQuotaCache,
} from "../usage/components/ProviderLimits/utils";

// Fixed categorical order (validated in globals.css). Never cycled: the tail folds into "Other".
const SERIES = ["var(--color-chart-1)", "var(--color-chart-2)", "var(--color-chart-3)", "var(--color-chart-4)"];
const OTHER = "var(--color-chart-other)";
const MAX_QUOTA_CARDS = 12;
const QUOTA_CACHE_FRESH_MS = 5 * 60 * 1000;

function providerName(id) {
  return AI_PROVIDERS[id]?.name || id;
}

// Top-N segments by value with the remainder folded into "Other"
function toSegments(entries, n = SERIES.length) {
  const sorted = entries.filter((e) => e.value > 0).sort((a, b) => b.value - a.value);
  const head = sorted.slice(0, n).map((e, i) => ({ ...e, color: SERIES[i] }));
  const rest = sorted.slice(n).reduce((s, e) => s + e.value, 0);
  if (rest > 0) head.push({ key: "__other", label: "Other", value: rest, color: OTHER });
  return head;
}

async function getJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export default function OverviewClient() {
  const [period, setPeriod] = useState("7d");
  const [stats, setStats] = useState(null);
  const [chart, setChart] = useState([]);
  const [errorCounts, setErrorCounts] = useState(null);
  const [connections, setConnections] = useState([]);
  const [quotaConns, setQuotaConns] = useState([]);
  // Seeded from the Quota Tracker's localStorage cache; stale entries refetch below
  const [quotas, setQuotas] = useState(() => getQuotaCache());
  const [quotaLoading, setQuotaLoading] = useState({});
  const [logProviders, setLogProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  // Period-scoped metrics
  useEffect(() => {
    let cancelled = false;
    const since = new Date(Date.now() - getPeriodDays(period) * 86400000).toISOString();
    Promise.allSettled([
      getJson(`/api/usage/stats?period=${period}`),
      getJson(`/api/usage/chart?period=${period}`),
      getJson(`/api/usage/request-details?pageSize=1&startDate=${encodeURIComponent(since)}`),
      getJson(`/api/usage/request-details?pageSize=1&status=error&startDate=${encodeURIComponent(since)}`),
    ]).then(([s, c, all, err]) => {
      if (cancelled) return;
      setStats(s.status === "fulfilled" ? s.value : null);
      setChart(c.status === "fulfilled" && Array.isArray(c.value) ? c.value : []);
      setErrorCounts(all.status === "fulfilled" && err.status === "fulfilled"
        ? { total: all.value.pagination?.totalItems || 0, errors: err.value.pagination?.totalItems || 0 }
        : null);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [period, refreshKey]);

  const fetchQuota = useCallback(async (conn) => {
    setQuotaLoading((p) => ({ ...p, [conn.id]: true }));
    try {
      const data = await getJson(`/api/usage/${conn.id}`);
      const entry = { quotas: parseQuotaData(conn.provider, data), plan: data.plan || null, message: data.message || null };
      setQuotas((p) => ({ ...p, [conn.id]: entry }));
      setQuotaCache(conn.id, entry);
    } catch (e) {
      setQuotas((p) => ({ ...p, [conn.id]: { quotas: [], message: "Quota unavailable" } }));
    } finally {
      setQuotaLoading((p) => ({ ...p, [conn.id]: false }));
    }
  }, []);

  // Connections (all + quota-eligible) — period independent.
  // Quota is only refetched for entries whose cache is stale (or on manual refresh)..
  // Quota is only refetched for entries whose cache is stale (or on manual refresh).
  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      getJson("/api/providers"),
      getJson(`/api/providers/client?page=1&pageSize=${MAX_QUOTA_CARDS}&accountStatus=active&sort=priority`),
      getJson("/api/usage/providers"),
    ]).then(([all, eligible, lp]) => {
      if (cancelled) return;
      setConnections(all.status === "fulfilled" ? all.value.connections || [] : []);
      setQuotaConns(eligible.status === "fulfilled" ? eligible.value.connections || [] : []);
      setLogProviders(lp.status === "fulfilled" ? lp.value.providers || [] : []);
      const cache = getQuotaCache();
      for (const conn of eligible.status === "fulfilled" ? eligible.value.connections || [] : []) {
        const cachedAt = cache[conn.id]?.cachedAt ? new Date(cache[conn.id].cachedAt).getTime() : 0;
        if (refreshKey > 0 || Date.now() - cachedAt > QUOTA_CACHE_FRESH_MS) fetchQuota(conn);
      }
    });
    return () => { cancelled = true; };
  }, [refreshKey, fetchQuota]);

  const connectionNames = useMemo(() => {
    const map = {};
    for (const c of connections) map[c.id] = c.email || c.name || c.displayName || c.id.slice(0, 8);
    return map;
  }, [connections]);

  const usageByConnection = useMemo(() => {
    const map = {};
    for (const a of Object.values(stats?.byAccount || {})) {
      const m = (map[a.connectionId] ||= { requests: 0, tokens: 0 });
      m.requests += a.requests || 0;
      m.tokens += (a.promptTokens || 0) + (a.completionTokens || 0);
    }
    return map;
  }, [stats]);

  const days = getPeriodDays(period);
  const totalTokens = (stats?.totalPromptTokens || 0) + (stats?.totalCompletionTokens || 0);
  const cachedPct = stats?.totalPromptTokens ? (stats.totalCachedTokens / stats.totalPromptTokens) * 100 : 0;
  const activeKeys = Object.values(stats?.byApiKey || {}).reduce((set, k) => set.add(k.apiKeyKey), new Set()).size;
  const errorRate = errorCounts?.total ? (errorCounts.errors / errorCounts.total) * 100 : 0;

  const accountStates = connections.map(getAccountState);
  const activeCount = accountStates.filter((s) => s.variant === "success").length;
  const unavailableCount = accountStates.filter((s) => s.variant === "error" || s.variant === "warning").length;

  const series = (key) => chart.map((b) => ({ label: b.label, value: b[key] || 0 }));

  const tokenSegments = toSegments(Object.entries(stats?.byProvider || {}).map(([id, p]) => ({
    key: id, label: providerName(id), value: (p.promptTokens || 0) + (p.completionTokens || 0),
  })));
  const accountSegments = toSegments(Object.entries(usageByConnection).map(([id, u]) => ({
    key: id, label: connectionNames[id] || id.slice(0, 8), value: u.requests,
  })));
  const modelCost = {};
  for (const m of Object.values(stats?.byModel || {})) modelCost[m.rawModel] = (modelCost[m.rawModel] || 0) + (m.cost || 0);
  const costSegments = toSegments(Object.entries(modelCost).map(([model, cost]) => ({ key: model, label: model, value: cost })));

  const periodLabel = period.toUpperCase();

  return (
    <div className="flex flex-col gap-8">
      {/* Heading */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text-main">Dashboard</h1>
          <p className="mt-1 text-[13px] text-text-muted">Overview, account health, and recent request logs.</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={period}
            onChange={(e) => { setLoading(true); setPeriod(e.target.value); }}
            aria-label="Time range"
            className="h-8 w-24 rounded-[6px] border border-border bg-surface px-2.5 text-[13px] font-medium text-text-main focus:border-text-subtle focus:outline-none"
          >
            {PERIOD_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
          <button
            type="button"
            onClick={() => { setLoading(true); setRefreshKey((k) => k + 1); }}
            aria-label="Refresh dashboard"
            title="Refresh"
            className="flex size-8 items-center justify-center rounded-[6px] border border-border text-text-muted hover:bg-surface-2 hover:text-text-main"
          >
            <span className={`material-symbols-outlined text-[16px] ${loading ? "animate-spin" : ""}`}>refresh</span>
          </button>
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <KpiTile
          label={`Requests (${periodLabel})`}
          icon="monitoring"
          loading={loading}
          value={formatCompact(stats?.totalRequests)}
          sub={`Avg/day ${formatCompact((stats?.totalRequests || 0) / days)}`}
          series={series("requests")}
          color="var(--color-chart-1)"
          format={(v) => v.toLocaleString()}
        />
        <KpiTile
          label={`Tokens (${periodLabel})`}
          icon="token"
          loading={loading}
          value={formatCompact(totalTokens)}
          sub={`Cached: ${formatCompact(stats?.totalCachedTokens)} (${cachedPct.toFixed(0)}%)`}
          series={series("tokens")}
          color="var(--color-chart-1)"
          format={formatCompact}
        />
        <KpiTile
          label={`Est. API cost (${periodLabel})`}
          icon="attach_money"
          loading={loading}
          value={formatCost(stats?.totalCost)}
          sub={`Avg/day ${formatCost((stats?.totalCost || 0) / days)}`}
          series={series("cost")}
          color="var(--color-chart-1)"
          format={formatCost}
        />
        <KpiTile
          label={`Active API keys (${periodLabel})`}
          icon="key"
          loading={loading}
          value={activeKeys}
          sub={`${Object.keys(stats?.byModel || {}).length} model routes used`}
        />
        <KpiTile
          label={`Error rate (${periodLabel})`}
          icon="warning"
          loading={loading}
          value={errorCounts ? formatPercent(errorRate) : "—"}
          sub={errorCounts ? `${errorCounts.errors.toLocaleString()} of ${errorCounts.total.toLocaleString()} logged requests` : "Request logging disabled"}
        />
      </div>

      {/* Distribution donuts */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <DonutCard
          title="Tokens by provider"
          centerLabel="Tokens"
          centerValue={formatCompact(totalTokens)}
          segments={tokenSegments}
          format={formatCompact}
          footer={`Total ${formatCompact(totalTokens)} · ${Object.keys(stats?.byProvider || {}).length} providers`}
        />
        <DonutCard
          title="Requests by account"
          centerLabel="Requests"
          centerValue={formatCompact(stats?.totalRequests)}
          segments={accountSegments}
          format={(v) => v.toLocaleString()}
          footer={`${Object.keys(usageByConnection).length} accounts served traffic`}
        />
        <DonutCard
          title="Cost by model"
          centerLabel="Cost"
          centerValue={formatCost(stats?.totalCost)}
          segments={costSegments}
          format={formatCost}
          footer="Estimated from configured pricing"
        />
      </div>

      {/* Accounts */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-3 text-[12px]">
          <h2 className="label-caps !text-[11px] !text-text-main">Accounts</h2>
          <span className="text-text-muted"><span className="num font-semibold text-text-main">{connections.length}</span> registered</span>
          <span className="text-text-muted"><span className="num font-semibold text-green-500">{activeCount}</span> active</span>
          <span className="text-text-muted"><span className="num font-semibold text-red-500">{unavailableCount}</span> unavailable</span>
          <div className="section-rule" />
        </div>
        {quotaConns.length === 0 ? (
          <div className="rounded-[8px] border border-dashed border-border px-4 py-8 text-center text-[13px] text-text-muted">
            No quota-tracked accounts yet. Connect an OAuth provider on the Providers page.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {quotaConns.map((conn) => {
              const u = usageByConnection[conn.id] || { requests: 0, tokens: 0 };
              return (
                <AccountCard
                  key={conn.id}
                  connection={conn}
                  quota={quotas[conn.id]}
                  loading={quotaLoading[conn.id]}
                  usage={{ requests: u.requests, tokensLabel: formatCompact(u.tokens) }}
                />
              );
            })}
          </div>
        )}
      </section>

      <RequestLogTable connectionNames={connectionNames} providers={logProviders} />
    </div>
  );
}
