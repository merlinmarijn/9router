// Compact number formatting shared by the overview widgets (3.06K, 226.41M).
export function formatCompact(value) {
  const n = Number(value) || 0;
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return `${Math.round(n)}`;
}

export function formatCost(value) {
  const n = Number(value) || 0;
  if (n > 0 && n < 0.01) return "<$0.01";
  return `$${n.toFixed(2)}`;
}

export function formatPercent(value, digits = 1) {
  const n = Number(value) || 0;
  return `${n.toFixed(digits)}%`;
}

export function formatMs(ms) {
  const n = Number(ms) || 0;
  if (n <= 0) return "—";
  if (n < 1000) return `${Math.round(n)}ms`;
  return `${(n / 1000).toFixed(1)}s`;
}

export const PERIOD_OPTIONS = [
  { value: "24h", label: "24h", days: 1 },
  { value: "7d", label: "7d", days: 7 },
  { value: "30d", label: "30d", days: 30 },
];

export function getPeriodDays(period) {
  return PERIOD_OPTIONS.find((p) => p.value === period)?.days || 7;
}
