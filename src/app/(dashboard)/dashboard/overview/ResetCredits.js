"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Button, Modal } from "@/shared/components";

const SPENT_STATUSES = new Set(["used", "consumed", "redeemed", "expired", "revoked"]);
const URGENT_MS = 24 * 60 * 60 * 1000;

function expiryMs(value) {
  if (!value) return Number.POSITIVE_INFINITY;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
}

// Normalize Codex credits / Claude grants into one sorted list (soonest expiry first).
// Each item: { key, expiresAt, count, willBeUsed }
export function getResetInfo(provider, entry) {
  const now = Date.now();
  const raw = entry?.raw?.resetCredits;

  if (provider === "codex") {
    if (!raw && !entry?.resetList) return null;
    const items = (entry?.resetList || [])
      .filter((c) => !SPENT_STATUSES.has(String(c.status).toLowerCase()) && expiryMs(c.expiresAt) > now)
      .sort((a, b) => expiryMs(a.expiresAt) - expiryMs(b.expiresAt))
      .map((c, i) => ({ key: `${c.expiresAt || "none"}-${i}`, expiresAt: c.expiresAt, count: 1, willBeUsed: i === 0 }));
    const count = Number.isFinite(raw?.availableCount) ? raw.availableCount : items.length;
    return { count, items, soonest: items[0]?.expiresAt || null, nextGrantId: null };
  }

  if (provider === "claude") {
    if (!raw) return null;
    const items = (raw.grants || [])
      .filter((g) => !g.paused && g.resetsLeft > 0 && expiryMs(g.endsAt) > now)
      .sort((a, b) => expiryMs(a.endsAt) - expiryMs(b.endsAt))
      .map((g) => ({ key: g.id, expiresAt: g.endsAt, count: g.resetsLeft, willBeUsed: g.id === raw.nextGrantId }));
    return { count: raw.availableCount || 0, items, soonest: items[0]?.expiresAt || null, nextGrantId: raw.nextGrantId };
  }

  return null;
}

export function formatRelative(value) {
  const diff = expiryMs(value) - Date.now();
  if (!Number.isFinite(diff)) return "";
  if (diff <= 0) return "expired";
  const minutes = Math.ceil(diff / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function isUrgent(value) {
  return expiryMs(value) - Date.now() < URGENT_MS;
}

function formatStamp(value) {
  if (!value) return "no expiry";
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "unknown";
  return `${d.toLocaleTimeString()} ${d.toLocaleDateString()}`;
}

// Card footer button: "Reset (N)" with the soonest expiry floating top-right
export function ResetButton({ info, onClick, busy }) {
  if (!info) return null;
  const disabled = info.count <= 0 || busy;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={info.count > 0 ? "Redeem a rate-limit reset credit" : "No reset credits available"}
      className="relative flex items-center gap-1 hover:text-text-main disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-text-muted"
    >
      <span className={`material-symbols-outlined text-[14px] ${busy ? "animate-spin" : ""}`}>
        {busy ? "progress_activity" : "restart_alt"}
      </span>
      Reset (<span className="num">{info.count}</span>)
      {info.count > 0 && info.soonest && (
        <span
          className={`num absolute -right-3 -top-2.5 text-[9.5px] font-semibold ${isUrgent(info.soonest) ? "text-red-500" : "text-text-muted"}`}
        >
          {formatRelative(info.soonest)}
        </span>
      )}
    </button>
  );
}

ResetButton.propTypes = {
  info: PropTypes.object,
  onClick: PropTypes.func,
  busy: PropTypes.bool,
};

const AUTO_REDEEM_OPTIONS = [
  { value: "default", label: "Default" },
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
];

export function autoRedeemMode(connection) {
  const v = connection?.providerSpecificData?.autoRedeemResets;
  return v === true ? "on" : v === false ? "off" : "default";
}

// Per-connection override of the global "auto-redeem expiring resets" setting
export function AutoRedeemSelect({ connection, globalEnabled, onChange, busy }) {
  const mode = autoRedeemMode(connection);
  const effective = mode === "default" ? globalEnabled : mode === "on";
  return (
    <label
      className="flex items-center gap-1"
      title={`Auto-redeem a reset credit 5 minutes before it expires (currently ${effective ? "on" : "off"})`}
    >
      <span className={`material-symbols-outlined text-[14px] ${effective ? "text-green-500" : ""}`}>autorenew</span>
      <select
        value={mode}
        disabled={busy}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Auto-redeem expiring resets"
        className="bg-transparent text-[11.5px] text-text-muted hover:text-text-main focus:outline-none disabled:opacity-50"
      >
        {AUTO_REDEEM_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.value === "default" ? `Auto (${globalEnabled ? "on" : "off"})` : `Auto ${o.label.toLowerCase()}`}
          </option>
        ))}
      </select>
    </label>
  );
}

AutoRedeemSelect.propTypes = {
  connection: PropTypes.object.isRequired,
  globalEnabled: PropTypes.bool,
  onChange: PropTypes.func.isRequired,
  busy: PropTypes.bool,
};

export function RedeemResetModal({ state, onClose, onConfirm }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  if (!state) return null;
  const { info, provider, label } = state;
  const isClaude = provider === "claude";

  const handleConfirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setError(e.message || "Failed to redeem reset credit");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={submitting ? () => {} : onClose}
      title="Redeem rate-limit reset credit"
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button variant="primary" onClick={handleConfirm} loading={submitting} disabled={info.count <= 0}>
            Redeem credit
          </Button>
        </>
      }
    >
      <p className="text-[13px] text-text-muted">
        {isClaude
          ? <>This redeems the next scheduled reset grant for <span className="text-text-main">{label}</span> and refills its limits.</>
          : <>This redeems the soonest-expiring banked reset credit for <span className="text-text-main">{label}</span>.</>}
        {" "}This cannot be undone.
      </p>

      <h4 className="mt-4 text-[13px] font-semibold text-text-main">
        <span className="num">{info.count}</span> free rate limit reset{info.count === 1 ? "" : "s"}
      </h4>
      {info.items.length === 0 ? (
        <p className="mt-2 text-xs text-text-muted">No expiry details returned for this account.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5 text-xs text-text-muted">
          {info.items.map((item) => (
            <li key={item.key}>
              {item.willBeUsed ? "Reset" : "Other"} expires on <span className="num">{formatStamp(item.expiresAt)}</span>
              {item.expiresAt && (
                <span className={`num ${isUrgent(item.expiresAt) ? "text-red-500" : ""}`}> ({formatRelative(item.expiresAt)})</span>
              )}
              {item.count > 1 && <span className="num"> ×{item.count}</span>}
              {item.willBeUsed && <span className="text-text-main"> will be used</span>}
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="mt-3 flex items-center gap-1 rounded-[6px] border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-xs text-red-500">
          <span className="material-symbols-outlined text-[14px]">error</span>
          {error}
        </p>
      )}
    </Modal>
  );
}

RedeemResetModal.propTypes = {
  state: PropTypes.shape({
    info: PropTypes.object.isRequired,
    provider: PropTypes.string.isRequired,
    label: PropTypes.string,
  }),
  onClose: PropTypes.func.isRequired,
  onConfirm: PropTypes.func.isRequired,
};
