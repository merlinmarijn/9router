const SPENT = new Set(["used", "consumed", "redeemed", "expired", "revoked"]);

export function widgetAccount(connection, quota = {}, usage, now = Date.now()) {
  const raw = quota.resetCredits;
  const grants = connection.provider === "claude" ? raw?.grants : quota.credits;
  const expiries = (Array.isArray(grants) ? grants : []).filter(item => {
    const expiry = item.endsAt || item.expiresAt;
    return !item.paused && !SPENT.has(String(item.status).toLowerCase())
      && (connection.provider !== "claude" || item.resetsLeft > 0)
      && (!expiry || new Date(expiry).getTime() > now);
  }).map(item => ({
    count: connection.provider === "claude" ? item.resetsLeft : 1,
    expiresAt: item.endsAt || item.expiresAt || null,
  })).sort((a, b) => (Date.parse(a.expiresAt) || Infinity) - (Date.parse(b.expiresAt) || Infinity));
  return {
    id: connection.id, provider: connection.provider,
    label: connection.email || connection.name || connection.displayName || connection.id.slice(0, 8),
    status: connection.isActive === false ? "Disabled"
      : ({ error: "Error", expired: "Expired", unavailable: "Cooling down" }[connection.testStatus] || "Active"),
    plan: quota.plan || null, quotas: quota.quotas || [],
    updatedAt: quota.updatedAt || null, error: quota.error || null,
    requests: usage?.requests ?? 0, tokens: usage?.tokens ?? 0,
    resets: raw ? { count: raw.availableCount ?? expiries.reduce((n, item) => n + item.count, 0), expiries } : null,
  };
}
