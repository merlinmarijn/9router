import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getClaudeQuotaResetAt } from "open-sse/services/usage/claude.js";
import { unavailableResponse } from "open-sse/utils/error.js";
import { clearSessionAffinity, setSessionBinding } from "@/lib/sessionAffinity.js";

const state = vi.hoisted(() => ({ connections: [] }));
vi.mock("@/lib/localDb", () => ({
  getProviderConnections: async () => state.connections,
  updateProviderConnection: async (id, patch) => Object.assign(state.connections.find(c => c.id === id), patch),
  getSettings: async () => ({}), getProxyPools: vi.fn(), validateApiKey: vi.fn(),
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: async () => ({}), pickProxyPoolId: vi.fn(),
}));
vi.mock("@/sse/services/antigravityQuota.js", () => ({ getAntigravityQuotaCache: () => new Map() }));
vi.mock("@/sse/utils/logger.js", () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn() }));

const { getProviderCredentials, markAccountUnavailable } = await import("@/sse/services/auth.js");
const model = "claude-opus-5-5";
const hour = 3600_000;
const now = Date.parse("2026-10-18T14:00:00Z");
const iso = (ms) => new Date(now + ms).toISOString();
const exhausted = (ms) => ({ remainingPercentage: 0, resetAt: iso(ms) });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.spyOn(console, "error").mockImplementation(() => {});
  clearSessionAffinity();
  state.connections = [{ id: "account", provider: "claude", isActive: true, backoffLevel: 5 }];
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it("uses latest relevant exhausted window, ignoring another model and healthy windows", () => {
  const usage = { quotas: {
    "session (5h)": exhausted(4 * hour),
    "weekly (7d)": { ...exhausted(7 * 24 * hour), remainingPercentage: 20 },
    "weekly opus (7d)": exhausted(24 * hour),
    "weekly sonnet (7d)": exhausted(48 * hour),
  } };
  expect(getClaudeQuotaResetAt(null, usage, model)).toBe(now + 24 * hour);
});

it("accepts rejected unified reset headers, without mistaking Retry-After for quota reset", () => {
  const headers = new Headers({
    "Retry-After": "64",
    "anthropic-ratelimit-unified-status": "rejected",
    "anthropic-ratelimit-unified-reset": String((now + 4 * hour) / 1000),
  });
  expect(getClaudeQuotaResetAt(headers, null, model)).toBe(now + 4 * hour);
  headers.set("anthropic-ratelimit-unified-status", "allowed");
  expect(getClaudeQuotaResetAt(headers, null, model)).toBeNull();
  headers.set("anthropic-ratelimit-unified-status", "rejected");
  for (const value of ["garbage", "Infinity", "0", String(now / 1000 - 1)]) {
    headers.set("anthropic-ratelimit-unified-reset", value);
    expect(getClaudeQuotaResetAt(headers, null, model)).toBeNull();
  }
});

it("preserves four-hour reset through DB selection and gateway response, including later requests", async () => {
  const reset = getClaudeQuotaResetAt(null, { quotas: { "session (5h)": exhausted(4 * hour) } }, model);
  const error = '[429]: {"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed your account\'s rate limit. Please try again later."},"request_id":"req_011Cg9sqbe8CEtMZ6rtqngvk"}';
  await markAccountUnavailable("account", 429, error, "claude", model, reset);
  const credentials = await getProviderCredentials("claude", null, model);
  expect(credentials.retryAfter).toBe(iso(4 * hour));
  expect(credentials.retryAfterHuman).toBe("reset after 4h");
  const response = unavailableResponse(503, "limited", credentials.retryAfter, credentials.retryAfterHuman);
  expect(response.headers.get("retry-after")).toBe("14400");
  expect((await response.json()).error.message).toBe("limited (reset after 4h)");
  expect(credentials.lastError).toBe(error);
  vi.advanceTimersByTime(hour);
  expect((await getProviderCredentials("claude", null, model)).retryAfterHuman).toBe("reset after 3h");
});

it("keeps strict session owner's reset when every account is blocked", async () => {
  state.connections.push({ id: "other", provider: "claude", isActive: true });
  setSessionBinding("pinned", "claude", "account", 24 * hour);
  await markAccountUnavailable("account", 429, "rate limit", "claude", model, now + 4 * hour);
  await markAccountUnavailable("other", 429, "rate limit", "claude", model, now + hour);
  const credentials = await getProviderCredentials("claude", null, model, {
    sessionAffinity: { key: "pinned", mode: "strict", ttlMs: 24 * hour },
  });
  expect(credentials.retryAfterHuman).toBe("reset after 4h");
});

it("labels unknown reset as retry backoff and replaces stale quota provenance", async () => {
  await markAccountUnavailable("account", 429, "rate limit", "claude", model, now + 4 * hour);
  state.connections[0].backoffLevel = 5;
  await markAccountUnavailable("account", 429, "rate limit", "claude", model);
  const credentials = await getProviderCredentials("claude", null, model);
  expect(credentials.retryAfterHuman).toBe("retry after 1m 4s");
});

it("uses earliest usable account for requested model, ignoring unrelated model locks", async () => {
  state.connections.push({ id: "other", provider: "claude", isActive: true });
  await markAccountUnavailable("account", 429, "rate limit", "claude", model, now + 4 * hour);
  await markAccountUnavailable("other", 429, "rate limit", "claude", model, now + 2 * hour);
  state.connections[0].modelLock_unrelated = iso(60_000);
  const credentials = await getProviderCredentials("claude", null, model);
  expect(credentials.retryConnectionId).toBe("other");
  expect(credentials.retryAfterHuman).toBe("reset after 2h");
});

it("honors account-wide reset when a model-specific lock already expired", async () => {
  await markAccountUnavailable("account", 429, "rate limit", "claude", null, now + 4 * hour);
  state.connections[0][`modelLock_${model}`] = iso(-1);
  expect((await getProviderCredentials("claude", null, model)).retryAfterHuman).toBe("reset after 4h");
});

it.each(["14400", new Date(now + 4 * hour).toUTCString()])("does not shorten upstream Retry-After %s", (retry) => {
  const response = unavailableResponse(503, "limited", iso(64_000), "retry after 1m 4s", { "Retry-After": retry });
  expect(response.headers.get("retry-after")).toBe(retry);
});

it("replaces malformed upstream Retry-After with valid router delay", () => {
  const response = unavailableResponse(503, "limited", iso(64_000), "retry after 1m 4s", { "Retry-After": "invalid" });
  expect(response.headers.get("retry-after")).toBe("64");
});
