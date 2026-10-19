import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { getClaudeUsage } from "../../open-sse/services/usage/claude.js";

const reply = (used) => Response.json({
  five_hour: { utilization: used, resets_at: "2030-01-01T05:00:00Z" },
  seven_day: { utilization: used + 10, resets_at: "2030-01-08T00:00:00Z" },
});
let token;
beforeEach(() => {
  token = crypto.randomUUID();
  vi.useFakeTimers();
  proxyAwareFetch.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it("retries after an initial network failure instead of caching a settled promise", async () => {
  proxyAwareFetch.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(reply(20));
  expect((await getClaudeUsage(token)).message).toContain("offline");
  expect((await getClaudeUsage(token)).quotas["session (5h)"].remainingPercentage).toBe(80);
  expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
});

it("refreshes successful reads after TTL and lets force bypass fresh cache", async () => {
  proxyAwareFetch.mockResolvedValueOnce(reply(10)).mockResolvedValueOnce(reply(20))
    .mockResolvedValueOnce(reply(30));
  await getClaudeUsage(token);
  await getClaudeUsage(token);
  expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
  expect((await getClaudeUsage(token, null, { force: true })).quotas["session (5h)"].remainingPercentage).toBe(80);
  vi.advanceTimersByTime(300001);
  expect((await getClaudeUsage(token)).quotas["weekly (7d)"].remainingPercentage).toBe(60);
  expect(proxyAwareFetch).toHaveBeenCalledTimes(3);
});

it.each([false, true])("recovers both windows after failed refresh (force=%s)", async (force) => {
  proxyAwareFetch.mockResolvedValueOnce(reply(20));
  await getClaudeUsage(token);
  if (!force) vi.advanceTimersByTime(300001);
  proxyAwareFetch.mockRejectedValueOnce(new Error("offline"));
  const stale = await getClaudeUsage(token, null, { force });
  expect(stale.quotas["session (5h)"].remainingPercentage).toBe(80);
  expect(stale.error).toContain("offline");
  proxyAwareFetch.mockResolvedValueOnce(reply(40));
  const fresh = await getClaudeUsage(token);
  expect(fresh.quotas["session (5h)"].remainingPercentage).toBe(60);
  expect(fresh.quotas["weekly (7d)"].remainingPercentage).toBe(50);
  expect(fresh.error).toBeUndefined();
  expect(proxyAwareFetch).toHaveBeenCalledTimes(3);
  await getClaudeUsage(token);
  expect(proxyAwareFetch).toHaveBeenCalledTimes(3);
});

it("shares in-flight fetches even for forced refreshes", async () => {
  let resolve;
  proxyAwareFetch.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const first = getClaudeUsage(token);
  const second = getClaudeUsage(token, null, { force: true });
  expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
  resolve(reply(10));
  expect(await first).toEqual(await second);
});

it("retries OAuth after its 429 cooldown expires", async () => {
  proxyAwareFetch.mockResolvedValueOnce(new Response(null, { status: 429 }))
    .mockResolvedValueOnce(new Response(null, { status: 403 }));
  expect((await getClaudeUsage(token)).message).toBeTruthy();
  vi.advanceTimersByTime(180001);
  proxyAwareFetch.mockResolvedValueOnce(reply(30));
  expect((await getClaudeUsage(token)).quotas["weekly (7d)"].remainingPercentage).toBe(60);
  expect(proxyAwareFetch).toHaveBeenCalledTimes(3);
});
