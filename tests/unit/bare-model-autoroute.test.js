// Bare model ids from CLI tools (e.g. Claude Code's "claude-opus-5-5") route to a
// connected provider that lists the model — no per-model alias setup needed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, afterEach, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;

async function setup() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-bare-model-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
  const db = await import("@/lib/db/index.js");
  const { getModelInfo } = await import("@/sse/services/model.js");
  return { ...db, getModelInfo };
}

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  vi.resetModules();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("bare model auto-routing", () => {
  it("routes a bare Claude id to the connected Claude Code provider", async () => {
    const ctx = await setup();
    await ctx.createProviderConnection({ provider: "claude", authType: "oauth", email: "a@test", accessToken: "t", isActive: true });

    await expect(ctx.getModelInfo("claude-opus-5-5")).resolves.toEqual({ provider: "claude", model: "claude-opus-5-5" });
    // thinking suffix still resolves to the base model's provider
    await expect(ctx.getModelInfo("claude-opus-5-5(high)")).resolves.toEqual({ provider: "claude", model: "claude-opus-5-5(high)" });
  });

  it("routes bare Codex ids to the connected Codex provider", async () => {
    const ctx = await setup();
    await ctx.createProviderConnection({ provider: "codex", authType: "oauth", email: "b@test", accessToken: "t", isActive: true });

    await expect(ctx.getModelInfo("gpt-5.5")).resolves.toEqual({ provider: "codex", model: "gpt-5.5" });
  });

  it("routes a bare id to a custom model registered on a connected provider", async () => {
    const ctx = await setup();
    await ctx.createProviderConnection({ provider: "openrouter", authType: "apikey", name: "k", apiKey: "k", isActive: true });
    await ctx.addCustomModel({ providerAlias: "openrouter", id: "my-custom-model", type: "llm" });

    await expect(ctx.getModelInfo("my-custom-model")).resolves.toEqual({ provider: "openrouter", model: "my-custom-model" });
  });

  it("keeps user model aliases ahead of auto-detection", async () => {
    const ctx = await setup();
    await ctx.createProviderConnection({ provider: "claude", authType: "oauth", email: "a@test", accessToken: "t", isActive: true });
    await ctx.setModelAlias("claude-opus-5-5", "anthropic/claude-opus-5-5");

    await expect(ctx.getModelInfo("claude-opus-5-5")).resolves.toEqual({ provider: "anthropic", model: "claude-opus-5-5" });
  });

  it("falls back to name inference when no connection lists the model", async () => {
    const ctx = await setup();
    await expect(ctx.getModelInfo("claude-opus-5-5")).resolves.toEqual({ provider: "anthropic", model: "claude-opus-5-5" });
  });
});
