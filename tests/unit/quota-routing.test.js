import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ connections: [], settings: {}, usage: {} }));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(async ({ provider, isActive } = {}) => {
    await Promise.resolve();
    return state.connections
      .filter((c) => (!provider || c.provider === provider) && (isActive === undefined || c.isActive === isActive))
      .sort((a, b) => a.priority - b.priority);
  }),
  updateProviderConnection: vi.fn(async (id, data) => {
    const conn = state.connections.find((c) => c.id === id);
    if (conn) Object.assign(conn, data);
    return conn;
  }),
  getSettings: vi.fn(async () => state.settings),
  getProxyPools: vi.fn(),
  validateApiKey: vi.fn(),
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(async () => ({})),
  pickProxyPoolId: vi.fn(),
}));
vi.mock("@/shared/constants/providers.js", () => ({
  FREE_PROVIDERS: {},
  resolveProviderId: (provider) => provider,
}));
vi.mock("open-sse/services/usage.js", () => ({
  getUsageForProvider: vi.fn(async (conn) => state.usage[conn.id] || { message: "n/a" }),
}));
vi.mock("@/sse/services/antigravityQuota.js", () => ({ getAntigravityQuotaCache: () => new Map() }));
vi.mock("@/sse/utils/logger.js", () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn() }));

const { getProviderCredentials } = await import("@/sse/services/auth.js");
const affinity = await import("@/lib/sessionAffinity.js");
const quota = await import("@/sse/services/quotaRouting.js");

const MODEL = "gpt-5.5";
let provider = "codex";

function makeConnections(n, providerId = provider) {
  return Array.from({ length: n }, (_, i) => ({
    id: `acct-${i + 1}`, provider: providerId, isActive: true, priority: i + 1, accessToken: `tok-${i + 1}`,
  }));
}

// remaining % per window, as the usage API reports it
function codexUsage(weekly, session = 100) {
  return { quotas: {
    weekly: { used: 100 - weekly, total: 100, remaining: weekly },
    session: { used: 100 - session, total: 100, remaining: session },
  } };
}

function seed(id, weekly, session = 100) {
  quota.setQuotaSnapshot(id, quota.scoreQuotas(provider, codexUsage(weekly, session).quotas));
}

async function route(sessionId) {
  const opts = sessionId
    ? { sessionAffinity: { key: affinity.buildSessionAffinityKey(provider, `cache:${sessionId}`), mode: "soft", ttlMs: 3600_000 } }
    : {};
  const creds = await getProviderCredentials(provider, null, MODEL, opts);
  return creds?.connectionId ?? creds;
}

beforeEach(() => {
  provider = "codex";
  affinity.clearSessionAffinity();
  quota.clearQuotaSnapshots();
  state.connections = makeConnections(2);
  state.settings = { fallbackStrategy: quota.MOST_QUOTA_STRATEGY };
  state.usage = {};
});

describe("quota scoring", () => {
  it("uses the main Codex pools and ignores review/spark pools", () => {
    const score = quota.scoreQuotas("codex", {
      ...codexUsage(90, 40).quotas,
      spark_weekly: { used: 100, total: 100, remaining: 0 },
      review_session: { used: 100, total: 100, remaining: 0 },
    });
    expect(score).toMatchObject({ long: 90, short: 40 });
  });

  it("reads Claude's named windows", () => {
    const score = quota.scoreQuotas("claude", {
      "session (5h)": { total: 100, remaining: 70 },
      "weekly (7d)": { total: 100, remaining: 55 },
      "weekly sonnet (7d)": { total: 100, remaining: 1 },
    });
    expect(score).toMatchObject({ long: 55, short: 70 });
  });

  it("generalizes to any provider: weekly/monthly windows are long, the rest short", () => {
    expect(quota.scoreQuotas("grok-cli", {
      "Monthly included": { total: 200, remaining: 50 },
      "Weekly SuperGrok": { total: 100, remaining: 80 },
      "On-demand": { total: 10, remaining: 10 },
    })).toMatchObject({ long: 25, short: 100 });
    expect(quota.scoreQuotas("antigravity", {
      "gemini-3-pro": { total: 100, remaining: 20 },
      "claude-opus": { total: 100, remaining: 90 },
    }, "claude-opus")).toMatchObject({ long: null, short: 90 });
    expect(quota.scoreQuotas("zed", { "Edit Predictions": { unlimited: true } })).toMatchObject({ long: null, short: 100 });
    expect(quota.scoreQuotas("x", undefined)).toBeNull();
  });
});

describe("most-quota strategy with session affinity", () => {
  it("pins a session, then sends the next new session to whichever account has more weekly left", async () => {
    seed("acct-1", 100);
    seed("acct-2", 90);
    expect(await route("A")).toBe("acct-1");
    seed("acct-1", 89); // session A drained account 1 below account 2
    expect(await route("A")).toBe("acct-1"); // A stays put
    expect(await route("B")).toBe("acct-2"); // new session → most weekly left
    expect(await route("A")).toBe("acct-1");
    expect(await route("B")).toBe("acct-2");
  });

  it("breaks weekly ties on the 5h window", async () => {
    seed("acct-1", 80, 30);
    seed("acct-2", 80, 60);
    expect(await route("A")).toBe("acct-2");
  });

  it("rotates new sessions by least-recently-selected when usage is unknown (any provider)", async () => {
    provider = "openai";
    state.connections = makeConnections(3, "openai");
    expect([await route("A"), await route("B"), await route("C"), await route("A")])
      .toEqual(["acct-1", "acct-2", "acct-3", "acct-1"]);
  });

  it("moves a session off an account past the 5h budget when a healthier one exists", async () => {
    seed("acct-1", 100);
    seed("acct-2", 90);
    expect(await route("A")).toBe("acct-1");
    seed("acct-1", 70, 4); // 96% of the 5h window used
    expect(await route("A")).toBe("acct-2");
    expect(await route("A")).toBe("acct-2"); // rebound, sticks there
  });

  it("keeps the session when every account is past its budget (no thrashing)", async () => {
    seed("acct-1", 100);
    seed("acct-2", 90);
    expect(await route("A")).toBe("acct-1");
    seed("acct-1", 50, 3);
    seed("acct-2", 60, 2);
    expect(await route("A")).toBe("acct-1");
  });

  it("routes session-less requests to the most-quota account every time", async () => {
    seed("acct-1", 40);
    seed("acct-2", 60);
    expect([await route(null), await route(null)]).toEqual(["acct-2", "acct-2"]);
  });

  it("fetches usage in the background and uses it once it lands", async () => {
    state.usage = { "acct-1": codexUsage(10), "acct-2": codexUsage(95) };
    // Cold cache: unknown usage → first pick by priority, refresh kicked off
    expect(await route(null)).toBe("acct-1");
    await vi.waitFor(async () => expect(await route("B")).toBe("acct-2"));
  });

  it("keeps the last snapshot when a refresh returns nothing usable", async () => {
    seed("acct-1", 30);
    quota.setQuotaSnapshot("acct-2", { long: 80, short: 100 }, 0); // stale → refresh
    state.usage = { "acct-2": { message: "Usage API temporarily unavailable (401)." } };
    await quota.refreshQuotaIfStale(state.connections[1], MODEL);
    expect(await route("A")).toBe("acct-2");
  });
});

describe("reset-aware (use-it-or-lose-it) ranking", () => {
  const H = 3600_000;
  const snap = (id, long, longInH, short = 100, shortInH = 3) => quota.setQuotaSnapshot(id, {
    long, short, longResetAt: Date.now() + longInH * H, shortResetAt: Date.now() + shortInH * H,
  });

  it("keeps resetAt from the usage payload", () => {
    const resetAt = new Date(Date.now() + 38 * H).toISOString();
    const score = quota.scoreQuotas("claude", { "weekly (7d)": { total: 100, remaining: 37, resetAt } });
    expect(score.long).toBe(37);
    expect(score.longResetAt).toBe(Date.parse(resetAt));
  });

  it("drains the account whose weekly resets soonest even with less left", async () => {
    snap("acct-1", 33, 127); // 33% left, 5d7h
    snap("acct-2", 37, 38);  // 37% left, 1d14h
    expect(await route(null)).toBe("acct-2");
    snap("acct-2", 20, 38);
    expect(await route(null)).toBe("acct-2"); // 0.53%/h still beats 0.26%/h
  });

  it("skips an account whose 5h window is spent, and returns once it resets", async () => {
    snap("acct-1", 33, 127);
    snap("acct-2", 37, 38, 0, 1);
    expect(await route(null)).toBe("acct-1");
    snap("acct-2", 37, 38, 0, -0.01); // 5h reset time passed → counts as refilled
    expect(await route(null)).toBe("acct-2");
  });

  it("moves a sticky session only when another account is ≥2× more urgent", async () => {
    snap("acct-1", 50, 100); // 0.5%/h
    snap("acct-2", 40, 100); // 0.4%/h
    expect(await route("A")).toBe("acct-1");
    snap("acct-2", 40, 60);  // 0.67%/h — better, but not 2× → stay (prompt cache)
    expect(await route("A")).toBe("acct-1");
    snap("acct-2", 40, 30);  // 1.33%/h → move
    expect(await route("A")).toBe("acct-2");
  });

  it("never moves a session onto an exhausted account", async () => {
    snap("acct-1", 50, 100);
    snap("acct-2", 0, 1);
    expect(await route("A")).toBe("acct-1");
    expect(await route("A")).toBe("acct-1");
  });
});
