"use client";

import { useId, useMemo, useState } from "react";
import PropTypes from "prop-types";

const W = 100;
const H = 32;

// Tiny trend line for KPI tiles: 2px stroke, faint area, crosshair + tooltip on hover.
export default function Sparkline({ data, color, format }) {
  const gradientId = useId();
  const [hover, setHover] = useState(null);

  const points = useMemo(() => {
    if (!data?.length) return [];
    const values = data.map((d) => d.value || 0);
    const max = Math.max(...values, 0);
    const step = data.length > 1 ? W / (data.length - 1) : 0;
    return data.map((d, i) => ({
      x: data.length > 1 ? i * step : W / 2,
      // keep 2px headroom so the stroke never clips at the top
      y: max > 0 ? H - 2 - ((d.value || 0) / max) * (H - 4) : H - 2,
      label: d.label,
      value: d.value || 0,
    }));
  }, [data]);

  if (points.length === 0) {
    return <div className="h-8 w-full border-b border-dashed border-border" />;
  }

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const area = `${line} L${points[points.length - 1].x},${H} L${points[0].x},${H} Z`;

  const handleMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const idx = Math.round(ratio * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, idx)));
  };

  const active = hover !== null ? points[hover] : null;

  return (
    <div
      className="relative h-8 w-full"
      onMouseMove={handleMove}
      onMouseLeave={() => setHover(null)}
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full overflow-visible" aria-hidden="true">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gradientId})`} />
        <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {active && (
          <line x1={active.x} x2={active.x} y1="0" y2={H} stroke="var(--color-text-subtle)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      {active && (
        <>
          <span
            className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface"
            style={{ left: `${(active.x / W) * 100}%`, top: `${(active.y / H) * 100}%`, background: color }}
          />
          <div
            className="pointer-events-none absolute bottom-full z-10 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-[6px] border border-border bg-surface-2 px-2 py-1 text-[11px] shadow-[var(--shadow-elev)]"
            style={{ left: `${Math.min(85, Math.max(15, (active.x / W) * 100))}%` }}
          >
            <span className="text-text-muted">{active.label}</span>
            <span className="num ml-2 text-text-main">{format ? format(active.value) : active.value}</span>
          </div>
        </>
      )}
    </div>
  );
}

Sparkline.propTypes = {
  data: PropTypes.arrayOf(PropTypes.shape({ label: PropTypes.string, value: PropTypes.number })),
  color: PropTypes.string.isRequired,
  format: PropTypes.func,
};
