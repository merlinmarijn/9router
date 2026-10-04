// Rewrite stored model strings from legacy short provider aliases ("cx/gpt-5.5")
// to the provider id ("codex/gpt-5.5"), which is now the only public prefix.
// Legacy aliases still resolve at request time; this keeps dashboard lookups
// (custom models, disabled lists, model aliases, combos) matching the new prefix.
import REGISTRY from "../../../../open-sse/providers/registry/index.js";

function buildLegacyMap() {
  const ids = new Set(REGISTRY.map((r) => r.id));
  const map = {};
  for (const r of REGISTRY) {
    for (const a of [r.alias, r.uiAlias, ...(r.aliases || [])]) {
      if (a && !ids.has(a) && !(a in map)) map[a] = r.id;
    }
  }
  return map;
}

function rewriteModel(value, legacy) {
  if (typeof value !== "string") return value;
  const slash = value.indexOf("/");
  if (slash <= 0) return value;
  const id = legacy[value.slice(0, slash)];
  return id ? `${id}${value.slice(slash)}` : value;
}

function parse(text, fallback) {
  try { return JSON.parse(text); } catch { return fallback; }
}

export default {
  version: 2,
  name: "provider-id-prefixes",
  up(db) {
    const legacy = buildLegacyMap();

    // modelAliases: value = "provider/model"
    for (const row of db.all(`SELECT key, value FROM kv WHERE scope = 'modelAliases'`)) {
      const v = parse(row.value, null);
      const next = rewriteModel(v, legacy);
      if (next !== v) db.run(`UPDATE kv SET value = ? WHERE scope = 'modelAliases' AND key = ?`, [JSON.stringify(next), row.key]);
    }

    // customModels: key = `${providerAlias}|${id}|${type}`
    for (const row of db.all(`SELECT key, value FROM kv WHERE scope = 'customModels'`)) {
      const m = parse(row.value, null);
      const id = m && legacy[m.providerAlias];
      if (!id) continue;
      const next = { ...m, providerAlias: id };
      const newKey = `${id}|${m.id}|${m.type || "llm"}`;
      db.run(`DELETE FROM kv WHERE scope = 'customModels' AND key = ?`, [row.key]);
      db.run(
        `INSERT INTO kv(scope, key, value) VALUES('customModels', ?, ?) ON CONFLICT(scope, key) DO NOTHING`,
        [newKey, JSON.stringify(next)]
      );
    }

    // disabledModels: key = provider alias, value = [modelId]
    for (const row of db.all(`SELECT key, value FROM kv WHERE scope = 'disabledModels'`)) {
      const id = legacy[row.key];
      if (!id) continue;
      const ids = parse(row.value, []);
      const existing = db.get(`SELECT value FROM kv WHERE scope = 'disabledModels' AND key = ?`, [id]);
      const merged = [...new Set([...(existing ? parse(existing.value, []) : []), ...ids])];
      db.run(`DELETE FROM kv WHERE scope = 'disabledModels' AND key = ?`, [row.key]);
      db.run(
        `INSERT INTO kv(scope, key, value) VALUES('disabledModels', ?, ?) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
        [id, JSON.stringify(merged)]
      );
    }

    // mitmAlias: value = { toolModel: "provider/model" }
    for (const row of db.all(`SELECT key, value FROM kv WHERE scope = 'mitmAlias'`)) {
      const mappings = parse(row.value, null);
      if (!mappings || typeof mappings !== "object") continue;
      let changed = false;
      for (const [k, v] of Object.entries(mappings)) {
        const next = rewriteModel(v, legacy);
        if (next !== v) { mappings[k] = next; changed = true; }
      }
      if (changed) db.run(`UPDATE kv SET value = ? WHERE scope = 'mitmAlias' AND key = ?`, [JSON.stringify(mappings), row.key]);
    }

    // combos: models = ["provider/model" | { model: "provider/model", ... }]
    for (const row of db.all(`SELECT id, models FROM combos`)) {
      const models = parse(row.models, null);
      if (!Array.isArray(models)) continue;
      let changed = false;
      const next = models.map((m) => {
        if (typeof m === "string") {
          const r = rewriteModel(m, legacy);
          if (r !== m) changed = true;
          return r;
        }
        if (m && typeof m.model === "string") {
          const r = rewriteModel(m.model, legacy);
          if (r !== m.model) { changed = true; return { ...m, model: r }; }
        }
        return m;
      });
      if (changed) db.run(`UPDATE combos SET models = ? WHERE id = ?`, [JSON.stringify(next), row.id]);
    }
  },
};
