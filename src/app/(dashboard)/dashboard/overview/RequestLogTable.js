"use client";

import { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import Link from "next/link";
import { Badge } from "@/shared/components";
import { formatCompact, formatMs } from "./format";

const PAGE_SIZES = [25, 50, 100];

function tokenParts(t = {}) {
  const input = t.prompt_tokens ?? t.input_tokens ?? 0;
  const output = t.completion_tokens ?? t.output_tokens ?? 0;
  const cached = t.cached_tokens ?? t.cache_read_input_tokens ?? t.prompt_tokens_details?.cached_tokens ?? 0;
  const reasoning = t.reasoning_tokens ?? t.completion_tokens_details?.reasoning_tokens ?? 0;
  return { total: input + output, cached, reasoning, output };
}

function tps(detail) {
  const { output } = tokenParts(detail.tokens);
  const total = detail.latency?.total || 0;
  const ttft = detail.latency?.ttft || 0;
  const genMs = total - ttft;
  if (!output || genMs <= 0) return null;
  return output / (genMs / 1000);
}

function StatusPill({ status }) {
  const ok = !status || status === "success" || status === "ok" || status === "completed";
  return <Badge size="sm" variant={ok ? "success" : "error"}>{ok ? "OK" : "ERR"}</Badge>;
}

StatusPill.propTypes = { status: PropTypes.string };

export default function RequestLogTable({ connectionNames, providers }) {
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, totalItems: 0 });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [provider, setProvider] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [nonce, setNonce] = useState(0);
  const queryKey = `${page}|${pageSize}|${provider}|${status}|${nonce}`;
  const [loadedKey, setLoadedKey] = useState(null);
  const loading = loadedKey !== queryKey;

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (provider) params.set("provider", provider);
    if (status) params.set("status", status);
    fetch(`/api/usage/request-details?${params}`, { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setRows(data.details || []);
        setPagination(data.pagination || { page: 1, totalPages: 1, totalItems: 0 });
      })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoadedKey(queryKey); });
    return () => { cancelled = true; };
  }, [page, pageSize, provider, status, queryKey]);

  // Free-text search narrows the current page client-side (API has no text filter)
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((d) => [d.id, d.model, d.provider, connectionNames[d.connectionId], d.status]
      .filter(Boolean).some((v) => String(v).toLowerCase().includes(q)));
  }, [rows, search, connectionNames]);

  const resetFilters = () => { setProvider(""); setStatus(""); setSearch(""); setPage(1); };

  const selectClass = "h-8 rounded-[6px] border border-border bg-surface-2 px-2.5 text-[12.5px] font-medium text-text-main focus:outline-none focus:border-text-subtle";

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <h2 className="label-caps !text-[11px] !text-text-main">Request logs</h2>
        <div className="section-rule" />
        <button
          type="button"
          onClick={() => setNonce((n) => n + 1)}
          className="flex size-8 items-center justify-center rounded-[6px] border border-border text-text-muted hover:bg-surface-2 hover:text-text-main"
          title="Refresh"
          aria-label="Refresh request logs"
        >
          <span className={`material-symbols-outlined text-[16px] ${loading ? "animate-spin" : ""}`}>refresh</span>
        </button>
      </div>

      <div className="flex flex-col gap-2 rounded-[8px] border border-border bg-surface p-3">
        <div className="relative">
          <span className="material-symbols-outlined pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[16px] text-text-muted">search</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search request id, account, model, provider…"
            className="h-8 w-full rounded-[6px] border border-border bg-bg pl-8 pr-3 text-[13px] text-text-main placeholder-text-subtle focus:border-text-subtle focus:outline-none"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={provider} onChange={(e) => { setProvider(e.target.value); setPage(1); }} className={selectClass} aria-label="Filter by provider">
            <option value="">All providers</option>
            {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={selectClass} aria-label="Filter by status">
            <option value="">All statuses</option>
            <option value="success">OK</option>
            <option value="error">Error</option>
          </select>
          <button type="button" onClick={resetFilters} className="flex h-8 items-center gap-1 px-2 text-[12.5px] text-text-muted hover:text-text-main">
            <span className="material-symbols-outlined text-[15px]">restart_alt</span>
            Reset
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-[8px] border border-border bg-surface">
        <table className="w-full min-w-[960px] text-left text-[12.5px]">
          <thead>
            <tr className="border-b border-border">
              {["Time", "Account", "Provider", "Model", "Status", "TTFT", "TPS", "Tokens", ""].map((h, i) => (
                <th key={h || i} className={`label-caps px-3 py-2.5 font-medium ${["TTFT", "TPS", "Tokens"].includes(h) ? "text-right" : ""}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr><td colSpan={9} className="px-3 py-10 text-center text-text-muted">Loading…</td></tr>
            ) : visible.length === 0 ? (
              <tr><td colSpan={9} className="px-3 py-10 text-center text-text-muted">No requests found. Request logging may be disabled in Settings.</td></tr>
            ) : visible.map((d, idx) => {
              const t = tokenParts(d.tokens);
              const ts = new Date(d.timestamp);
              const speed = tps(d);
              return (
                <tr key={`${d.id}-${idx}`} className="border-b border-border-subtle align-top last:border-b-0 hover:bg-surface-2/50">
                  <td className="whitespace-nowrap px-3 py-2.5">
                    <div className="num font-medium text-text-main">{ts.toLocaleTimeString()}</div>
                    <div className="num text-[11px] text-text-muted">{ts.toLocaleDateString()}</div>
                  </td>
                  <td className="max-w-[180px] truncate px-3 py-2.5 font-medium text-text-main" title={connectionNames[d.connectionId] || ""}>
                    {connectionNames[d.connectionId] || <span className="text-text-muted">—</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="rounded-[4px] border border-border bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-text-main">{d.provider}</span>
                  </td>
                  <td className="num max-w-[260px] truncate px-3 py-2.5 text-text-main" title={d.model}>{d.model}</td>
                  <td className="px-3 py-2.5"><StatusPill status={d.status} /></td>
                  <td className="num whitespace-nowrap px-3 py-2.5 text-right text-text-main">{formatMs(d.latency?.ttft)}</td>
                  <td className="num whitespace-nowrap px-3 py-2.5 text-right text-text-main">{speed ? speed.toFixed(1) : "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right">
                    <div className="num font-medium text-text-main">{formatCompact(t.total)}</div>
                    {t.cached > 0 && <div className="num text-[11px] text-text-muted">{formatCompact(t.cached)} cached</div>}
                    {t.reasoning > 0 && <div className="num text-[11px] text-text-muted">{formatCompact(t.reasoning)} reasoning</div>}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <Link href="/dashboard/usage?tab=details" className="text-[12px] font-medium text-text-main hover:underline">View details</Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3 text-[12px] text-text-muted">
        <label className="flex items-center gap-2">
          Rows
          <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} className={selectClass}>
            {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <span className="num">
          {pagination.totalItems === 0 ? "0" : `${(pagination.page - 1) * pageSize + 1}–${Math.min(pagination.page * pageSize, pagination.totalItems)}`} of {pagination.totalItems}
        </span>
        {[
          { icon: "first_page", to: 1, disabled: page <= 1, label: "First page" },
          { icon: "chevron_left", to: page - 1, disabled: page <= 1, label: "Previous page" },
          { icon: "chevron_right", to: page + 1, disabled: page >= pagination.totalPages, label: "Next page" },
          { icon: "last_page", to: pagination.totalPages, disabled: page >= pagination.totalPages, label: "Last page" },
        ].map((b) => (
          <button
            key={b.icon}
            type="button"
            disabled={b.disabled}
            onClick={() => setPage(b.to)}
            aria-label={b.label}
            className="flex size-8 items-center justify-center rounded-[6px] border border-border text-text-main hover:bg-surface-2 disabled:opacity-40"
          >
            <span className="material-symbols-outlined text-[16px]">{b.icon}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

RequestLogTable.propTypes = {
  connectionNames: PropTypes.object.isRequired,
  providers: PropTypes.array.isRequired,
};
