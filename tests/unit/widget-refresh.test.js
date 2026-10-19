import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: async () => [{ id: "claude-account", provider: "claude" }],
}));
vi.mock("@/lib/usageDb", () => ({ getUsageStats: async () => ({}) }));
vi.mock("../../src/app/api/usage/[connectionId]/route", () => ({ GET: vi.fn() }));
vi.mock("../../src/app/api/usage/[connectionId]/codex-reset-credits/route", () => ({ GET: vi.fn() }));
import { GET as quota } from "../../src/app/api/usage/[connectionId]/route";
import { GET } from "../../src/app/api/usage/widget/route.js";

afterEach(() => vi.useRealTimers());
it("keeps automatic cache but manual force refreshes limits and preserves stale data on failure", async () => {
  vi.useFakeTimers();
  const request = force => new Request(`https://router.test/api/usage/widget${force ? '?force=1' : ''}`);
  const reply = remaining => Response.json({ quotas: {
    "session (5h)": { remainingPercentage: remaining, used: 100 - remaining, total: 100 },
    "weekly (7d)": { remainingPercentage: 95, used: 5, total: 100 },
  } });
  quota.mockResolvedValueOnce(reply(100)).mockResolvedValueOnce(reply(19))
    .mockResolvedValueOnce(Response.json({ error: "offline" }, { status: 503 }));
  const first = await (await GET(request(false))).json();
  vi.advanceTimersByTime(60001);
  expect((await (await GET(request(false))).json()).accounts[0].quotas[0].remaining).toBe(100);
  expect(quota).toHaveBeenCalledTimes(1);
  const fresh = await (await GET(request(true))).json();
  expect(fresh.accounts[0].quotas[0].remaining).toBe(19);
  expect(fresh.accounts[0].quotas[1].remaining).toBe(95);
  expect(quota.mock.calls[1][0].url).toContain("force=1");
  expect(fresh.accounts[0].updatedAt).not.toBe(first.accounts[0].updatedAt);
  vi.advanceTimersByTime(1000);
  const stale = await (await GET(request(true))).json();
  expect(stale.accounts[0].quotas).toEqual(fresh.accounts[0].quotas);
  expect(stale.accounts[0].updatedAt).toBe(fresh.accounts[0].updatedAt);
  expect(stale.accounts[0].error).toBeTruthy();
});
