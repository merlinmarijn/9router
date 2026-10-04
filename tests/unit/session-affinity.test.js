import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// In-memory connection table; updateProviderConnection mutates it so round-robin
// bookkeeping (lastUsedAt / consecutiveUseCount) behaves like the real DB.
const state = vi.hoisted(() => ({ connections: [], settings: {} }));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(async ({ provider, isActive } = {}) => {
    await Promise.resolve(); // yield, so concurrent callers really interleave
    return state.connections
      .filter((c) => (!provider || c.provider === provider) && (isActive === undefined || c.isActive === isActive))
      .sort((a, b) => a.priority - b.priority);
  }),
  // Write lands before the yield, so a racing selector would see round-robin advance
  updateProviderConnection: vi.fn(async (id, data) => {
    const conn = state.connections.find((c) => c.id === id);
    if (conn) Object.assign(conn, data);
    await Promise.resolve();
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
vi.mock("@/sse/services/antigravityQuota.js", () => ({ getAntigravityQuotaCache: () => new Map() }));
vi.mock("@/sse/utils/logger.js", () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn() }));

const { getProviderCredentials } = await import("@/sse/services/auth.js");
const affinity = await import("@/lib/sessionAffinity.js");
const { extractAffinitySessionId } = await import("open-sse/utils/sessionManager.js");

const PROVIDER = "codex";
const MODEL = "gpt-5.5";
const TTL_MS = 14400 * 1000;

function makeConnections(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `acct-${i + 1}`,
    provider: PROVIDER,
    isActive: true,
    priority: i + 1,
    accessToken: `tok-${i + 1}`,
  }));
}

function session(id, mode = "soft") {
  return { key: affinity.buildSessionAffinityKey(PROVIDER, `cache:${id}`), mode, ttlMs: TTL_MS };
}

async function route(sessionId, { mode = "soft", exclude = null } = {}) {
  const opts = sessionId ? { sessionAffinity: session(sessionId, mode) } : {};
  const creds = await getProviderCredentials(PROVIDER, exclude, MODEL, opts);
  return creds?.connectionId ?? creds;
}

function lockModel(id, ms = 60_000, extra = {}) {
  const conn = state.connections.find((c) => c.id === id);
  conn[`modelLock_${MODEL}`] = new Date(Date.now() + ms).toISOString();
  Object.assign(conn, extra);
}

beforeEach(() => {
  affinity.clearSessionAffinity();
  state.connections = makeConnections(3);
  state.settings = { fallbackStrategy: "round-robin", stickyRoundRobinLimit: 1 };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("session affinity key extraction", () => {
  it("prefers prompt_cache_key, then session headers, then body ids", () => {
    expect(extractAffinitySessionId({ session_id: "hdr" }, { prompt_cache_key: "pck" })).toBe("cache:pck");
    expect(extractAffinitySessionId({ session_id: "conv-1" }, {})).toBe("session:conv-1");
    expect(extractAffinitySessionId({ "x-session-id": "xs" }, {})).toBe("session:xs");
    expect(extractAffinitySessionId({}, { conversation: { id: "conv_9" } })).toBe("session:conv_9");
    expect(extractAffinitySessionId({}, { conversation_id: "c2" })).toBe("session:c2");
  });

  it("recognizes Claude Code sessions", () => {
    const body = { metadata: { user_id: "user_abc_account__session_1234abcd-0000" } };
    expect(extractAffinitySessionId({}, body)).toBe("claude:1234abcd-0000");
    expect(extractAffinitySessionId({ "x-claude-code-session-id": "s-1" }, {})).toBe("claude:s-1");
  });

  it("ignores per-request ids and returns null without a stable id", () => {
    expect(extractAffinitySessionId({ "x-client-request-id": "req-1" }, { previous_response_id: "resp_1" })).toBeNull();
    expect(extractAffinitySessionId({}, { model: "x", input: [] })).toBeNull();
    expect(extractAffinitySessionId(undefined, undefined)).toBeNull();
  });

  it("scopes keys per provider and never stores raw ids", () => {
    const a = affinity.buildSessionAffinityKey("codex", "cache:abc");
    const b = affinity.buildSessionAffinityKey("openai", "cache:abc");
    expect(a).not.toBe(b);
    expect(a.startsWith("codex:")).toBe(true);
    expect(a).not.toContain("abc");
    expect(affinity.buildSessionAffinityKey("codex", null)).toBeNull();
  });

  it("resolves config with backward-compatible defaults", () => {
    expect(affinity.resolveSessionAffinityConfig({})).toEqual({ mode: "disabled", ttlMs: TTL_MS });
    expect(affinity.resolveSessionAffinityConfig({ sessionAffinity: "bogus" }).mode).toBe("disabled");
    expect(affinity.resolveSessionAffinityConfig({ sessionAffinity: "strict", sessionAffinityTtlSeconds: 60 }))
      .toEqual({ mode: "strict", ttlMs: 60_000 });
  });
});

describe("session affinity routing", () => {
  it("keeps the same session on one account", async () => {
    const results = [await route("A"), await route("A"), await route("A")];
    expect(results).toEqual(["acct-1", "acct-1", "acct-1"]);
  });

  it("assigns different sessions with the configured strategy (round-robin)", async () => {
    expect([await route("A"), await route("B"), await route("C")]).toEqual(["acct-1", "acct-2", "acct-3"]);
  });

  it("routes interleaved sessions back to their own account", async () => {
    const order = ["A", "B", "A", "C", "B", "A"];
    const results = [];
    for (const s of order) results.push([s, await route(s)]);
    expect(results).toEqual([
      ["A", "acct-1"], ["B", "acct-2"], ["A", "acct-1"],
      ["C", "acct-3"], ["B", "acct-2"], ["A", "acct-1"],
    ]);
  });

  it("assigns new sessions with fill-first when that is the configured strategy", async () => {
    state.settings = { fallbackStrategy: "fill-first" };
    expect([await route("A"), await route("B")]).toEqual(["acct-1", "acct-1"]);
    // Owner cools down → new sessions go to the next priority, A keeps its binding
    lockModel("acct-1");
    expect(await route("C")).toBe("acct-2");
  });

  it("leaves requests without an affinity id on normal routing", async () => {
    expect([await route(null), await route(null), await route(null), await route(null)])
      .toEqual(["acct-1", "acct-2", "acct-3", "acct-1"]);
    expect(affinity.getSessionAffinitySize()).toBe(0);
  });

  it("re-assigns a session after its TTL expires without activity", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-04T00:00:00Z"));
    expect(await route("A")).toBe("acct-1");
    vi.setSystemTime(new Date(Date.now() + TTL_MS - 1000));
    expect(await route("A")).toBe("acct-1"); // use refreshes the sliding TTL
    vi.setSystemTime(new Date(Date.now() + TTL_MS - 1000));
    expect(await route("A")).toBe("acct-1");
    vi.setSystemTime(new Date(Date.now() + TTL_MS + 1));
    expect(await route("A")).toBe("acct-2"); // expired → fresh round-robin pick
  });

  it("recovers when the pinned account is removed", async () => {
    expect(await route("A")).toBe("acct-1");
    state.connections = state.connections.filter((c) => c.id !== "acct-1");
    const next = await route("A");
    expect(next).not.toBe("acct-1");
    expect(await route("A")).toBe(next);
  });

  it("recovers when the pinned account is disabled", async () => {
    expect(await route("A")).toBe("acct-1");
    state.connections[0].isActive = false;
    const next = await route("A", { mode: "strict" });
    expect(next).toMatch(/^acct-[23]$/);
    expect(await route("A", { mode: "strict" })).toBe(next);
  });

  it("drops bindings eagerly when a connection is cleared", async () => {
    expect(await route("A")).toBe("acct-1");
    expect(await route("B")).toBe("acct-2");
    affinity.clearSessionAffinityForConnection("acct-1");
    expect(affinity.getSessionAffinitySize()).toBe(1);
    affinity.clearSessionAffinityForProvider(PROVIDER);
    expect(affinity.getSessionAffinitySize()).toBe(0);
  });

  it("creates exactly one assignment for concurrent first requests of one session", async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => route("A")));
    expect(new Set(results).size).toBe(1);
    expect(affinity.getSessionAffinitySize()).toBe(1);
  });

  it("soft: fails over to a sticky stand-in while the owner cools down, then returns", async () => {
    expect(await route("A")).toBe("acct-1");
    expect(await route("B")).toBe("acct-2");
    lockModel("acct-1", 30_000);
    const standIn = await route("A");
    expect(standIn).not.toBe("acct-1");
    // No bouncing across the pool while the owner is still cooling down
    expect(await route("B")).toBe("acct-2");
    expect(await route("A")).toBe(standIn);
    expect(await route("A")).toBe(standIn);
    // Cooldown over → back to the owner (binding was preserved)
    state.connections[0][`modelLock_${MODEL}`] = null;
    expect(await route("A")).toBe("acct-1");
  });

  it("soft: fails over within a request when the owner was just excluded", async () => {
    expect(await route("A")).toBe("acct-1");
    expect(await route("A", { exclude: new Set(["acct-1"]) })).not.toBe("acct-1");
    expect(await route("A")).toBe("acct-1");
  });

  it("strict: keeps ownership during a temporary cooldown and reports retry-after", async () => {
    expect(await route("A", { mode: "strict" })).toBe("acct-1");
    lockModel("acct-1", 30_000, { lastError: "rate limit", errorCode: 429 });
    const blocked = await route("A", { mode: "strict" });
    expect(blocked.allRateLimited).toBe(true);
    expect(new Date(blocked.retryAfter).getTime()).toBeGreaterThan(Date.now());
    expect(blocked.lastErrorCode).toBe(429);
    state.connections[0][`modelLock_${MODEL}`] = null;
    expect(await route("A", { mode: "strict" })).toBe("acct-1");
  });

  it("strict: remaps when the owner fails authentication", async () => {
    expect(await route("A", { mode: "strict" })).toBe("acct-1");
    lockModel("acct-1", 120_000, { errorCode: 401, lastError: "token revoked" });
    const next = await route("A", { mode: "strict" });
    expect(next).toMatch(/^acct-[23]$/);
    // New owner sticks even after the old account recovers
    state.connections[0][`modelLock_${MODEL}`] = null;
    expect(await route("A", { mode: "strict" })).toBe(next);
  });

  it("remaps when the owner can no longer serve the requested model", async () => {
    expect(await route("A")).toBe("acct-1");
    state.connections[0].providerSpecificData = { enabledModels: ["other-model"] };
    const next = await route("A", { mode: "strict" });
    expect(next).toMatch(/^acct-[23]$/);
  });
});
