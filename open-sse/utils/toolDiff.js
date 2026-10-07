// Sanitized tool-definition diff: logs only tool type/name, never descriptions,
// schemas or headers. Active in dev or with NINEROUTER_DEBUG_TOOLS=1 (works in prod).
import { isDebugEnabled } from "./debugLog.js";

const enabled = () => isDebugEnabled || process.env.NINEROUTER_DEBUG_TOOLS === "1";

function label(tool) {
  if (!tool || typeof tool !== "object") return String(tool);
  const type = tool.type || "?";
  const name = tool.name || tool.function?.name;
  const base = name ? `${type}:${name}` : type;
  if (type === "namespace" && Array.isArray(tool.tools)) {
    return `${base}[${tool.tools.map(label).join(",")}]`;
  }
  return base;
}

// Responses tools live at body.tools and (Codex Responses Lite) in input additional_tools items.
export function summarizeTools(body) {
  const out = Array.isArray(body?.tools) ? body.tools.map(label) : [];
  if (Array.isArray(body?.input)) {
    for (const item of body.input) {
      if (item?.type === "additional_tools" && Array.isArray(item.tools)) out.push(...item.tools.map(label));
    }
  }
  return out;
}

export function diffTools(before, after) {
  const remaining = [...after];
  const removed = [];
  for (const t of before) {
    const i = remaining.indexOf(t);
    if (i >= 0) remaining.splice(i, 1);
    else removed.push(t);
  }
  return { removed, added: remaining };
}

export function logToolDiff(tag, before, after) {
  if (!enabled()) return;
  const { removed, added } = diffTools(before, after);
  const lines = [
    `[TOOLS:${tag}] incoming ${before.length}: ${before.join(", ") || "-"}`,
    `[TOOLS:${tag}] outgoing ${after.length}: ${after.join(", ") || "-"}`,
  ];
  if (removed.length) lines.push(`[TOOLS:${tag}] WARNING removed: ${removed.join(", ")}`);
  if (added.length) lines.push(`[TOOLS:${tag}] added/changed: ${added.join(", ")}`);
  console.log(lines.join("\n"));
}
