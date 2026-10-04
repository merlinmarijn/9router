// Re-export from open-sse with localDb integration
import { getModelAliases, getComboByName, getProviderNodes, getProviderConnections, getCustomModels } from "@/lib/localDb";
import { parseModel as parseModelCore, resolveModelAliasFromMap, getModelInfoCore, resolveProviderAlias } from "open-sse/services/model.js";
import { isValidModel } from "open-sse/config/providerModels.js";
import REGISTRY from "open-sse/providers/registry/index.js";

// Local provider alias overrides (HMR-friendly, applied on top of open-sse map)
const LOCAL_PROVIDER_ALIASES = {
  xmtp: "xiaomi-tokenplan",
  "xiaomi-tokenplan": "xiaomi-tokenplan",
};

const RESERVED_PROVIDER_PREFIXES = new Set(Object.keys(LOCAL_PROVIDER_ALIASES));
const REGISTRY_PRIORITY = {};
for (const entry of REGISTRY) {
  if (entry.priority !== undefined) REGISTRY_PRIORITY[entry.id] = entry.priority;
  RESERVED_PROVIDER_PREFIXES.add(entry.id);
  if (entry.alias) RESERVED_PROVIDER_PREFIXES.add(entry.alias);
  if (entry.uiAlias) RESERVED_PROVIDER_PREFIXES.add(entry.uiAlias);
  for (const alias of entry.aliases || []) RESERVED_PROVIDER_PREFIXES.add(alias);
}

export function parseModel(modelStr) {
  const parsed = parseModelCore(modelStr);
  if (parsed?.providerAlias && LOCAL_PROVIDER_ALIASES[parsed.providerAlias]) {
    return { ...parsed, provider: LOCAL_PROVIDER_ALIASES[parsed.providerAlias] };
  }
  return parsed;
}

/**
 * Resolve model alias from localDb
 */
export async function resolveModelAlias(alias) {
  const aliases = await getModelAliases();
  return resolveModelAliasFromMap(alias, aliases);
}

/**
 * Get full model info (parse or resolve)
 */
export async function getModelInfo(modelStr) {
  const parsed = parseModel(modelStr);

  if (!parsed.isAlias) {
    // Provider-node prefixes are user-defined. They must not override built-in
    // provider ids/aliases such as `cf`, `cloudflare-ai`, `openai`, or `hf`.
    if (!RESERVED_PROVIDER_PREFIXES.has(parsed.providerAlias)) {
      const openaiNodes = await getProviderNodes({ type: "openai-compatible" });
      const matchedOpenAI = openaiNodes.find((node) => node.prefix === parsed.providerAlias);
      if (matchedOpenAI) {
        return { provider: matchedOpenAI.id, model: parsed.model };
      }

      const anthropicNodes = await getProviderNodes({ type: "anthropic-compatible" });
      const matchedAnthropic = anthropicNodes.find((node) => node.prefix === parsed.providerAlias);
      if (matchedAnthropic) {
        return { provider: matchedAnthropic.id, model: parsed.model };
      }

      const embeddingNodes = await getProviderNodes({ type: "custom-embedding" });
      const matchedEmbedding = embeddingNodes.find((node) => node.prefix === parsed.providerAlias);
      if (matchedEmbedding) {
        return { provider: matchedEmbedding.id, model: parsed.model };
      }
    }
    return {
      provider: parsed.provider,
      model: parsed.model
    };
  }

  // Check if this is a combo name before resolving as alias
  // This prevents combo names from being incorrectly routed to providers
  const combo = await getComboByName(parsed.model);
  if (combo) {
    // Return null provider to signal this should be handled as combo
    // The caller (handleChat) will detect this and handle it as combo
    return { provider: null, model: parsed.model };
  }

  // User-defined aliases win; then route a bare model id (e.g. "claude-opus-5-5" from
  // Claude Code) to a connected provider that lists it, so CLI tools work without
  // per-model alias setup. Falls back to name-prefix inference.
  const aliases = await getModelAliases();
  const aliased = resolveModelAliasFromMap(parsed.model, aliases);
  if (aliased) return aliased;

  const detected = await findConnectedProviderForModel(parsed.model);
  if (detected) return { provider: detected, model: parsed.model };

  return getModelInfoCore(modelStr, aliases);
}

/**
 * Find the first active connection (in connection priority order) whose provider
 * serves this bare model id — via its registry model list or a custom model.
 * @returns {Promise<string|null>} provider id
 */
export async function findConnectedProviderForModel(modelId) {
  if (!modelId) return null;
  const connections = await getProviderConnections({ isActive: true });
  if (!connections.length) return null;

  // Several providers can list the same id (claude OAuth vs anthropic API key):
  // prefer the registry's provider priority (lower first), then connection order.
  const providers = [...new Set(connections.map((c) => c.provider))]
    .sort((a, b) => (REGISTRY_PRIORITY[a] ?? 999) - (REGISTRY_PRIORITY[b] ?? 999));
  const registryMatch = providers.find((provider) => isValidModel(provider, modelId));
  if (registryMatch) return registryMatch;

  const custom = await getCustomModels();
  return providers.find((provider) => custom.some(
    (m) => m?.id === modelId && (m.kind || m.type || "llm") === "llm"
      && resolveProviderAlias(m.providerAlias) === provider
  )) || null;
}

/**
 * Check if model is a combo and get models list
 * @returns {Promise<string[]|null>} Array of models or null if not a combo
 */
export async function getComboModels(modelStr) {
  // Only check if it's not in provider/model format
  if (modelStr.includes("/")) return null;

  const combo = await getComboByName(modelStr);
  if (combo && combo.models && combo.models.length > 0) {
    return combo.models;
  }
  return null;
}
