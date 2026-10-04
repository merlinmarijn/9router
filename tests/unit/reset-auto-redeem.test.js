import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("open-sse/index.js", () => ({}), { virtual: true });

vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(),
  getProviderConnections: vi.fn(),
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(),
}));

vi.mock("@/app/api/usage/[connectionId]/route.js", () => ({
  refreshAndUpdateCredentials: vi.fn(),
}));

const { runResetAutoRedeemTick, isAutoRedeemEnabled } = await import("../../src/shared/services/resetAutoRedeem.js");

const NOW = Date.parse("2026-10-04T12:00:00Z");
const MIN = 60000;
const iso = (ms) => new Date(ms).toISOString();

function freshState() {
  return { interval: null, running: false, soonest: {}, nextPollAt: {}, attempted: {}, failedAt: {} };
}

function makeDeps({ settings = { autoRedeemExpiringResets: true }, codex = [], claude = [], codexCredits = [], claudeGrants = [] } = {}) {
  return {
    getSettings: vi.fn().mockResolvedValue(settings),
    getProviderConnections: vi.fn(async ({ provider }) => (provider === "codex" ? codex : claude)),
    resolveConnectionProxyConfig: vi.fn().mockResolvedValue({}),
    refreshAndUpdateCredentials: vi.fn(async (connection) => ({ connection })),
    getCodexRateLimitResetCredits: vi.fn().mockResolvedValue({ availableCount: codexCredits.length, credits: codexCredits }),
    consumeCodexRateLimitResetCredit: vi.fn().mockResolvedValue({ ok: true, code: "reset", status: 200 }),
    getClaudeUsage: vi.fn().mockResolvedValue({ resetCredits: { grants: claudeGrants } }),
    consumeClaudeResetGrant: vi.fn().mockResolvedValue({ ok: true, result: "reset", status: 200 }),
  };
}

const codexConn = (psd = {}) => ({ id: "cx1", provider: "codex", authType: "oauth", accessToken: "t", providerSpecificData: psd });
const claudeConn = (psd = {}) => ({ id: "cl1", provider: "claude", authType: "oauth", accessToken: "t", providerSpecificData: psd });

describe("isAutoRedeemEnabled", () => {
  it("connection override wins over the global setting", () => {
    expect(isAutoRedeemEnabled(codexConn(), { autoRedeemExpiringResets: true })).toBe(true);
    expect(isAutoRedeemEnabled(codexConn(), { autoRedeemExpiringResets: false })).toBe(false);
    expect(isAutoRedeemEnabled(codexConn({ autoRedeemResets: true }), { autoRedeemExpiringResets: false })).toBe(true);
    expect(isAutoRedeemEnabled(codexConn({ autoRedeemResets: false }), { autoRedeemExpiringResets: true })).toBe(false);
    expect(isAutoRedeemEnabled(codexConn({ autoRedeemResets: null }), { autoRedeemExpiringResets: true })).toBe(true);
  });
});

describe("runResetAutoRedeemTick", () => {
  beforeEach(() => vi.spyOn(console, "log").mockImplementation(() => {}));

  it("redeems a Codex credit expiring within 5 minutes", async () => {
    const deps = makeDeps({
      codex: [codexConn()],
      codexCredits: [{ status: "available", grantedAt: "g1", expiresAt: iso(NOW + 4 * MIN) }],
    });
    await runResetAutoRedeemTick(deps, freshState(), NOW);
    expect(deps.consumeCodexRateLimitResetCredit).toHaveBeenCalledTimes(1);
  });

  it("does not redeem credits outside the window", async () => {
    const deps = makeDeps({
      codex: [codexConn()],
      codexCredits: [{ status: "available", grantedAt: "g1", expiresAt: iso(NOW + 10 * MIN) }],
    });
    await runResetAutoRedeemTick(deps, freshState(), NOW);
    expect(deps.consumeCodexRateLimitResetCredit).not.toHaveBeenCalled();
  });

  it("ignores spent and already-expired credits", async () => {
    const deps = makeDeps({
      codex: [codexConn()],
      codexCredits: [
        { status: "redeemed", grantedAt: "g1", expiresAt: iso(NOW + 2 * MIN) },
        { status: "available", grantedAt: "g2", expiresAt: iso(NOW - MIN) },
      ],
    });
    await runResetAutoRedeemTick(deps, freshState(), NOW);
    expect(deps.consumeCodexRateLimitResetCredit).not.toHaveBeenCalled();
  });

  it("does nothing when disabled globally and not overridden", async () => {
    const deps = makeDeps({
      settings: { autoRedeemExpiringResets: false },
      codex: [codexConn()],
      codexCredits: [{ status: "available", grantedAt: "g1", expiresAt: iso(NOW + 2 * MIN) }],
    });
    await runResetAutoRedeemTick(deps, freshState(), NOW);
    expect(deps.getCodexRateLimitResetCredits).not.toHaveBeenCalled();
    expect(deps.consumeCodexRateLimitResetCredit).not.toHaveBeenCalled();
  });

  it("honours a per-connection opt-in when global is off", async () => {
    const deps = makeDeps({
      settings: { autoRedeemExpiringResets: false },
      codex: [codexConn({ autoRedeemResets: true })],
      codexCredits: [{ status: "available", grantedAt: "g1", expiresAt: iso(NOW + 2 * MIN) }],
    });
    await runResetAutoRedeemTick(deps, freshState(), NOW);
    expect(deps.consumeCodexRateLimitResetCredit).toHaveBeenCalledTimes(1);
  });

  it("never redeems the same credit twice after success", async () => {
    const deps = makeDeps({
      codex: [codexConn()],
      codexCredits: [{ status: "available", grantedAt: "g1", expiresAt: iso(NOW + 4 * MIN) }],
    });
    const state = freshState();
    await runResetAutoRedeemTick(deps, state, NOW);
    await runResetAutoRedeemTick(deps, state, NOW + MIN);
    expect(deps.consumeCodexRateLimitResetCredit).toHaveBeenCalledTimes(1);
  });

  it("retries a failed redeem at most once", async () => {
    const deps = makeDeps({
      codex: [codexConn()],
      codexCredits: [{ status: "available", grantedAt: "g1", expiresAt: iso(NOW + 4 * MIN) }],
    });
    deps.consumeCodexRateLimitResetCredit.mockResolvedValue({ ok: false, code: "error", status: 500 });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const state = freshState();
    for (let i = 0; i < 4; i++) await runResetAutoRedeemTick(deps, state, NOW + i * 30000);
    expect(deps.consumeCodexRateLimitResetCredit).toHaveBeenCalledTimes(2);
  });

  it("wakes up for a cached credit entering the window between polls", async () => {
    const deps = makeDeps({
      codex: [codexConn()],
      codexCredits: [{ status: "available", grantedAt: "g1", expiresAt: iso(NOW + 8 * MIN) }],
    });
    const state = freshState();
    await runResetAutoRedeemTick(deps, state, NOW);
    expect(deps.consumeCodexRateLimitResetCredit).not.toHaveBeenCalled();
    await runResetAutoRedeemTick(deps, state, NOW + 4 * MIN); // within poll interval, but now due
    expect(deps.consumeCodexRateLimitResetCredit).toHaveBeenCalledTimes(1);
  });

  it("redeems one reset from the expiring Claude grant", async () => {
    const deps = makeDeps({
      claude: [claudeConn()],
      claudeGrants: [
        { id: "later", resetsLeft: 1, endsAt: iso(NOW + 60 * MIN), paused: false },
        { id: "soon", resetsLeft: 3, endsAt: iso(NOW + 3 * MIN), paused: false },
      ],
    });
    const state = freshState();
    await runResetAutoRedeemTick(deps, state, NOW);
    await runResetAutoRedeemTick(deps, state, NOW + MIN);
    expect(deps.consumeClaudeResetGrant).toHaveBeenCalledTimes(1);
    expect(deps.consumeClaudeResetGrant).toHaveBeenCalledWith("t", "soon", expect.any(Object));
  });

  it("skips API-key connections", async () => {
    const deps = makeDeps({
      claude: [{ ...claudeConn(), authType: "apikey" }],
      claudeGrants: [{ id: "soon", resetsLeft: 1, endsAt: iso(NOW + 3 * MIN), paused: false }],
    });
    await runResetAutoRedeemTick(deps, freshState(), NOW);
    expect(deps.getClaudeUsage).not.toHaveBeenCalled();
  });
});
