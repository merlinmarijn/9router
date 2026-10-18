import { describe, it, expect } from "vitest";
import { widgetAccount } from "../../src/lib/widgetAccount.js";

describe("widget account boundary", () => {
  it("exposes display fields only and excludes spent or expired resets", () => {
    const account = widgetAccount({ id: "abc", provider: "codex", accessToken: "SECRET", refreshToken: "SECRET", providerSpecificData: { secret: "SECRET" } }, {
      resetCredits: { availableCount: 2, secret: "SECRET" },
      credits: [
        { expiresAt: "2030-01-01", status: "available" },
        { expiresAt: "2031-01-01", status: "consumed" },
        { expiresAt: "2020-01-01", status: "available" },
        { expiresAt: null, status: "available" },
      ],
    }, { requests: 3, tokens: 100 }, Date.parse("2026-01-01"));
    expect(JSON.stringify(account)).not.toContain("SECRET");
    expect(account.resets.expiries).toEqual([{ count: 1, expiresAt: "2030-01-01" }, { count: 1, expiresAt: null }]);
    expect(account.requests).toBe(3);
  });
  it("handles disabled accounts and paused Claude grants", () => {
    const account = widgetAccount({ id: "abc", provider: "claude", isActive: false }, {
      resetCredits: { grants: [{ resetsLeft: 2, paused: true }, { resetsLeft: 3, endsAt: "2030-01-01" }] },
    }, undefined, Date.parse("2026-01-01"));
    expect(account.status).toBe("Disabled");
    expect(account.resets.count).toBe(3);
    expect(account.requests).toBe(0);
  });
});
