"use client";

import { useState } from "react";
import PropTypes from "prop-types";

const SIZE = 120;
const STROKE = 14;
const R = (SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;
const GAP = 2; // surface gap between segments

// Share-of-total ring with legend. Segments arrive pre-sorted and pre-colored
// (fixed categorical order; tail folded into "Other" by the caller).
export default function DonutCard({ title, centerLabel, centerValue, centerSub, segments, footer, format }) {
  const [hover, setHover] = useState(null);
  const total = segments.reduce((s, x) => s + x.value, 0);

  let offset = 0;
  const arcs = total > 0
    ? segments.map((seg) => {
      const len = (seg.value / total) * C;
      const visible = Math.max(0, len - (segments.length > 1 ? GAP : 0));
      const arc = { ...seg, dash: `${visible} ${C - visible}`, offset: -offset };
      offset += len;
      return arc;
    })
    : [];

  const active = hover !== null ? segments[hover] : null;

  return (
    <div className="flex min-w-0 flex-col rounded-[8px] border border-border bg-surface p-5">
      <h3 className="text-sm font-semibold text-text-main">{title}</h3>
      <div className="mt-4 flex flex-1 flex-col items-center gap-5 sm:flex-row">
        <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
          <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="-rotate-90">
            <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="var(--color-surface-2)" strokeWidth={STROKE} />
            {arcs.map((arc, i) => (
              <circle
                key={arc.key}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={R}
                fill="none"
                stroke={arc.color}
                strokeWidth={hover === i ? STROKE + 3 : STROKE}
                strokeDasharray={arc.dash}
                strokeDashoffset={arc.offset}
                className="cursor-pointer transition-[stroke-width] duration-150"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
            ))}
          </svg>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="label-caps !text-[9px]">{active ? active.label.slice(0, 14) : centerLabel}</span>
            <span className="num text-base font-semibold text-text-main">
              {active ? format(active.value) : centerValue}
            </span>
            {(active || centerSub) && (
              <span className="num text-[10px] text-text-muted">
                {active ? `${total > 0 ? ((active.value / total) * 100).toFixed(1) : 0}%` : centerSub}
              </span>
            )}
          </div>
        </div>
        <ul className="flex w-full min-w-0 flex-col gap-1.5">
          {segments.length === 0 && <li className="text-xs text-text-muted">No data for this period</li>}
          {segments.map((seg, i) => (
            <li
              key={seg.key}
              className={`flex items-center gap-2 rounded px-1 text-xs ${hover === i ? "bg-surface-2" : ""}`}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              <span className="size-2 shrink-0 rounded-full" style={{ background: seg.color }} />
              <span className="min-w-0 flex-1 truncate font-medium text-text-main" title={seg.label}>{seg.label}</span>
              <span className="num shrink-0 text-text-muted">{format(seg.value)}</span>
            </li>
          ))}
        </ul>
      </div>
      {footer && <p className="mt-4 text-[11px] text-text-muted">{footer}</p>}
    </div>
  );
}

DonutCard.propTypes = {
  title: PropTypes.string.isRequired,
  centerLabel: PropTypes.string,
  centerValue: PropTypes.node,
  centerSub: PropTypes.node,
  segments: PropTypes.arrayOf(PropTypes.shape({
    key: PropTypes.string.isRequired,
    label: PropTypes.string.isRequired,
    value: PropTypes.number.isRequired,
    color: PropTypes.string.isRequired,
  })).isRequired,
  footer: PropTypes.node,
  format: PropTypes.func.isRequired,
};
