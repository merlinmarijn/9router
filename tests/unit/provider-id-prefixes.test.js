// Public model prefix is the provider id; legacy short aliases (cx, cc, …) keep resolving.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, afterEach, vi } from "vitest";

describe("provider id prefixes", () => {
  it("exposes the provider id as the dashboard prefix", async () => {
    const { getProviderAlias, resolveProviderId, AI_PROVIDERS } = await import("../../src/shared/constants/providers.js");
    expect(AI_PROVIDERS.codex.alias).toBe("codex");
    expect(getProviderAlias("codex")).toBe("codex");
    expect(getProviderAlias("cx")).toBe("codex");
    expect(resolveProviderId("cc")).toBe("claude");
  });

  it("legacy aliases and ids share the same model registry", async () => {
    const { getProviderModels, isValidModel } = await import("../../open-sse/config/providerModels.js");
    const byId = getProviderModels("codex");
    expect(byId.length).toBeGreaterThan(0);
    expect(byId).toBe(getProviderModels("cx"));
    expect(isValidModel("codex", byId[0].id)).toBe(true);
  });

  it("routes both prefixes to the same provider", async () => {
    const { parseModel } = await import("../../open-sse/services/model.js");
    expect(parseModel("cx/gpt-5.5").provider).toBe("codex");
    expect(parseModel("codex/gpt-5.5").provider).toBe("codex");
  });
});

describe("migration 002 provider-id-prefixes", () => {
  let tempDir;
  const originalDataDir = process.env.DATA_DIR;

  afterEach(() => {
    try { global._dbAdapter?.instance?.close?.(); } catch {}
    delete global._dbAdapter;
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  it("rewrites stored legacy prefixes to provider ids", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-prefix-"));
    process.env.DATA_DIR = tempDir;
    delete global._dbAdapter;
    vi.resetModules();

    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const now = new Date().toISOString();
    db.run(`INSERT INTO kv(scope, key, value) VALUES('modelAliases', 'fast', ?)`, [JSON.stringify("cx/gpt-5.5")]);
    db.run(`INSERT INTO kv(scope, key, value) VALUES('customModels', 'cc|my-model|llm', ?)`, [JSON.stringify({ providerAlias: "cc", id: "my-model", type: "llm" })]);
    db.run(`INSERT INTO kv(scope, key, value) VALUES('disabledModels', 'cx', ?)`, [JSON.stringify(["gpt-5.5"])]);
    db.run(`INSERT INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES('c1', 'combo', NULL, ?, ?, ?)`, [JSON.stringify(["cx/gpt-5.5", "openai/gpt-4o", "other-combo"]), now, now]);

    const migration = (await import("@/lib/db/migrations/002-provider-id-prefixes.js")).default;
    migration.up(db);

    expect(JSON.parse(db.get(`SELECT value FROM kv WHERE scope='modelAliases' AND key='fast'`).value)).toBe("codex/gpt-5.5");
    const custom = db.all(`SELECT key, value FROM kv WHERE scope='customModels'`);
    expect(custom.map((r) => r.key)).toEqual(["claude|my-model|llm"]);
    expect(JSON.parse(custom[0].value).providerAlias).toBe("claude");
    const disabled = db.all(`SELECT key, value FROM kv WHERE scope='disabledModels'`);
    expect(disabled.map((r) => r.key)).toEqual(["codex"]);
    expect(JSON.parse(db.get(`SELECT models FROM combos WHERE id='c1'`).models)).toEqual(["codex/gpt-5.5", "openai/gpt-4o", "other-combo"]);
  });
});
