/**
 * Session → account affinity (Codex-LB style sticky sessions).
 *
 * Maps a stable client session key (scoped by provider) to the connection that
 * first served it, so every later request of that session reuses the same
 * account (prompt-cache locality). Bindings expire after a sliding TTL.
 *
 * In-memory only: a restart drops bindings and sessions are re-assigned by the
 * normal strategy on their next request. All reads/writes happen inside the
 * account-selection mutex in src/sse/services/auth.js, which makes
 * "lookup → assign" atomic for concurrent first requests.
 */
import crypto from "crypto";

export const SESSION_AFFINITY_MODES = ["disabled", "soft", "strict"];
export const DEFAULT_SESSION_AFFINITY_TTL_SECONDS = 4 * 60 * 60;
const MAX_BINDINGS = 10000;
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

// Key = "<providerId>:<sha>", Value = { providerId, connectionId, fallbackConnectionId, expiresAt }
const bindings = new Map();

/** Normalize settings into { mode, ttlMs }; mode "disabled" turns the feature off. */
export function resolveSessionAffinityConfig(settings = {}) {
  const mode = SESSION_AFFINITY_MODES.includes(settings.sessionAffinity) ? settings.sessionAffinity : "disabled";
  const ttlSeconds = Number(settings.sessionAffinityTtlSeconds);
  const ttl = Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? ttlSeconds : DEFAULT_SESSION_AFFINITY_TTL_SECONDS;
  return { mode, ttlMs: ttl * 1000 };
}

/** Provider-scoped key; the session id is hashed so raw ids are never retained. */
export function buildSessionAffinityKey(providerId, sessionId) {
  if (!providerId || !sessionId) return null;
  const hash = crypto.createHash("sha256").update(String(sessionId)).digest("hex").slice(0, 32);
  return `${providerId}:${hash}`;
}

/** Live binding for key (expired ones are dropped), or null. */
export function getSessionBinding(key, now = Date.now()) {
  const binding = bindings.get(key);
  if (!binding) return null;
  if (binding.expiresAt <= now) {
    bindings.delete(key);
    return null;
  }
  return binding;
}

/** Create/replace a binding and refresh its TTL. */
export function setSessionBinding(key, providerId, connectionId, ttlMs, now = Date.now()) {
  bindings.delete(key);
  if (bindings.size >= MAX_BINDINGS) bindings.delete(bindings.keys().next().value);
  const binding = { providerId, connectionId, fallbackConnectionId: null, expiresAt: now + ttlMs };
  bindings.set(key, binding);
  return binding;
}

/** Slide the TTL and move the key to the LRU tail. */
export function touchSessionBinding(key, ttlMs, now = Date.now()) {
  const binding = bindings.get(key);
  if (!binding) return;
  binding.expiresAt = now + ttlMs;
  bindings.delete(key);
  bindings.set(key, binding);
}

export function deleteSessionBinding(key) {
  bindings.delete(key);
}

/** Drop every binding pointing at a connection (deleted/disabled account). */
export function clearSessionAffinityForConnection(connectionId) {
  if (!connectionId) return;
  for (const [key, binding] of bindings) {
    if (binding.connectionId === connectionId) bindings.delete(key);
    else if (binding.fallbackConnectionId === connectionId) binding.fallbackConnectionId = null;
  }
}

export function clearSessionAffinityForProvider(providerId) {
  for (const [key, binding] of bindings) {
    if (binding.providerId === providerId) bindings.delete(key);
  }
}

export function clearSessionAffinity() {
  bindings.clear();
}

export function getSessionAffinitySize() {
  return bindings.size;
}

const sweep = setInterval(() => {
  const now = Date.now();
  for (const [key, binding] of bindings) {
    if (binding.expiresAt <= now) bindings.delete(key);
  }
}, SWEEP_INTERVAL_MS);
if (sweep.unref) sweep.unref();
