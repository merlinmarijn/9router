import { describe, it, expect } from "vitest";
import {
  buildPresetItems,
  buildCursorPresetItems,
  buildClaudePresetItems,
  isValidComboPresetName,
} from "../../src/lib/comboPresets.js";

describe("combo presets", () => {
  it("rejects combo names with slashes or invalid chars", () => {
    expect(isValidComboPresetName("composer-2.5")).toBe(true);
    expect(isValidComboPresetName("claude-opus-5")).toBe(true);
    expect(isValidComboPresetName("cursor/composer-2.5")).toBe(false);
    expect(isValidComboPresetName("bad name")).toBe(false);
    expect(isValidComboPresetName("")).toBe(false);
  });

  it("Cursor live ids become unprefixed names seeded with cursor/…", () => {
    const items = buildCursorPresetItems({
      liveModels: [
        { id: "composer-2.5", name: "Composer 2.5" },
        { id: "cursor-grok-4.6-high-fast", name: "Grok" },
        { id: "bad/with-slash", name: "Invalid" },
      ],
    });

    expect(items).toEqual([
      { name: "composer-2.5", models: ["cursor/composer-2.5"] },
      { name: "cursor-grok-4.6-high-fast", models: ["cursor/cursor-grok-4.6-high-fast"] },
    ]);
  });

  it("Cursor falls back to static cursor registry when live catalog is empty", () => {
    const items = buildCursorPresetItems({ liveModels: [] });
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.models[0].startsWith("cursor/"))).toBe(true);
    expect(items.some((i) => i.name === "default")).toBe(true);
    // No slash in combo name
    expect(items.every((i) => !i.name.includes("/"))).toBe(true);
  });

  it("Claude aliases map opus → claude/claude-opus-5 and registry models seed claude/…", () => {
    const items = buildClaudePresetItems();
    const byName = Object.fromEntries(items.map((i) => [i.name, i]));

    expect(byName["claude-opus-5"]).toEqual({
      name: "claude-opus-5",
      models: ["claude/claude-opus-5"],
    });
    expect(byName.opus).toEqual({
      name: "opus",
      models: ["claude/claude-opus-5"],
    });
    expect(byName.sonnet).toEqual({
      name: "sonnet",
      models: ["claude/claude-sonnet-5"],
    });
    expect(byName.haiku).toEqual({
      name: "haiku",
      models: ["claude/claude-haiku-4-5-20251001"],
    });
    expect(byName.fable).toEqual({
      name: "fable",
      models: ["claude/claude-fable-5"],
    });
    expect(byName.default).toEqual({
      name: "default",
      models: ["claude/claude-sonnet-5"],
    });
    expect(byName.opusplan).toEqual({
      name: "opusplan",
      models: ["claude/claude-opus-5"],
    });
  });

  it("marks existing names with exists: true", () => {
    const items = buildPresetItems("cursor", {
      liveModels: [
        { id: "composer-2.5" },
        { id: "gpt-5.3-codex" },
      ],
      existingNames: ["composer-2.5"],
    });

    expect(items).toEqual([
      { name: "composer-2.5", models: ["cursor/composer-2.5"], exists: true },
      { name: "gpt-5.3-codex", models: ["cursor/gpt-5.3-codex"], exists: false },
    ]);
  });

  it("returns empty for unknown source", () => {
    expect(buildPresetItems("unknown")).toEqual([]);
  });

  it("drops invalid names from Claude/Cursor catalogs", () => {
    const cursor = buildPresetItems("cursor", {
      liveModels: [{ id: "ok-model" }, { id: "no/slash" }, { id: "has space" }],
      existingNames: [],
    });
    expect(cursor.map((i) => i.name)).toEqual(["ok-model"]);
  });
});
