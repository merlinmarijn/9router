"use client";

import PropTypes from "prop-types";
import Sparkline from "./Sparkline";

export default function KpiTile({ label, icon, value, sub, series, color, format, loading }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-[8px] border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="label-caps">{label}</span>
        <span className="flex size-7 shrink-0 items-center justify-center rounded-[6px] border border-border bg-surface-2 text-text-muted">
          <span className="material-symbols-outlined text-[15px]">{icon}</span>
        </span>
      </div>
      {loading ? (
        <div className="h-7 w-24 animate-pulse rounded bg-surface-2" />
      ) : (
        <div className="num text-2xl font-semibold tracking-tight text-text-main">{value}</div>
      )}
      <div className="min-h-[16px] truncate text-[11.5px] text-text-muted">{sub}</div>
      {series !== undefined && <Sparkline data={series} color={color} format={format} />}
    </div>
  );
}

KpiTile.propTypes = {
  label: PropTypes.string.isRequired,
  icon: PropTypes.string.isRequired,
  value: PropTypes.node,
  sub: PropTypes.node,
  series: PropTypes.array,
  color: PropTypes.string,
  format: PropTypes.func,
  loading: PropTypes.bool,
};
