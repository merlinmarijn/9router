import { describe, expect, it } from "vitest";
import { combineProviderQuotas } from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

describe("combineProviderQuotas", () => {
  it("averages percent windows across active accounts, earliest reset", () => {
    const q = (remaining, resetAt) => ({ name: "5h", used: 100 - remaining, total: 100, remaining, resetAt });
    const connections = [
      { id: "a", provider: "claude" },
      { id: "b", provider: "claude" },
      { id: "c", provider: "claude", isActive: false },
      { id: "d", provider: "codex" },
    ];
    const quotaData = {
      a: { quotas: [q(0, "2026-01-02T00:00:00Z")] },
      b: { quotas: [q(100, "2026-01-01T00:00:00Z")] },
      c: { quotas: [q(100)] },
      d: { quotas: [q(0)] },
    };
    const res = combineProviderQuotas("claude", connections, quotaData);
    expect(res.accounts).toBe(2);
    expect(res.quotas).toEqual([
      { name: "5h", used: 50, total: 100, remaining: 50, remainingPercentage: 50, resetAt: "2026-01-01T00:00:00Z" },
    ]);
  });
});
