"use client";

import PropTypes from "prop-types";
import Link from "next/link";
import { Badge } from "@/shared/components";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { AutoRedeemSelect, ResetButton } from "./ResetCredits";
import {
  formatResetTime,
  getRemainingPercentage,
} from "../usage/components/ProviderLimits/utils";

export function getAccountState(connection) {
  if (connection.isActive === false) return { label: "Disabled", variant: "default" };
  const s = connection.testStatus;
  if (s === "error" || s === "expired") return { label: s === "expired" ? "Expired" : "Error", variant: "error" };
  if (s === "unavailable") return { label: "Cooling down", variant: "warning" };
  return { label: "Active", variant: "success" };
}

function barColor(pct) {
  if (pct > 70) return "bg-green-500";
  if (pct >= 30) return "bg-amber-500";
  return "bg-red-500";
}

function QuotaMeter({ quota }) {
  const pct = getRemainingPercentage(quota);
  const reset = formatResetTime(quota.resetAt);
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="truncate text-text-muted" title={quota.name}>{quota.name}</span>
        <span className="num font-medium text-text-main">{pct}%</span>
      </div>
      <div
        className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-3"
        role="meter"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${quota.name} remaining`}
      >
        <div className={`h-full rounded-full ${barColor(pct)}`} style={{ width: `${pct}%` }} />
      </div>
      {reset !== "-" && (
        <div className="mt-1 flex items-center gap-1 text-[10.5px] text-text-muted">
          <span className="material-symbols-outlined text-[12px]">schedule</span>
          in <span className="num">{reset}</span>
        </div>
      )}
    </div>
  );
}

QuotaMeter.propTypes = { quota: PropTypes.object.isRequired };

export default function AccountCard({ connection, quota, loading, usage, resetInfo, resetBusy, onReset, autoRedeem }) {
  const state = getAccountState(connection);
  const label = connection.email || connection.name || connection.displayName || connection.id.slice(0, 8);
  const quotas = (quota?.quotas || []).slice(0, 2);

  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-[8px] border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <ProviderIcon
            providerId={connection.provider}
            alt={connection.provider}
            size={24}
            className="shrink-0 rounded object-contain"
            fallbackText={connection.provider.slice(0, 2).toUpperCase()}
          />
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-text-main" title={label}>{label}</div>
            <div className="truncate text-[11px] capitalize text-text-muted">
              {connection.provider}{quota?.plan ? ` · ${quota.plan}` : ""}
            </div>
          </div>
        </div>
        <Badge variant={state.variant} size="sm" dot>{state.label}</Badge>
      </div>

      {loading && !quota ? (
        <div className="flex gap-4">
          <div className="h-8 flex-1 animate-pulse rounded bg-surface-2" />
          <div className="h-8 flex-1 animate-pulse rounded bg-surface-2" />
        </div>
      ) : quotas.length > 0 ? (
        <div className="flex gap-4">
          {quotas.map((q) => <QuotaMeter key={q.name} quota={q} />)}
        </div>
      ) : (
        <p className="text-[11px] text-text-muted">{quota?.message || "No quota data reported"}</p>
      )}

      <div className="grid grid-cols-2 gap-2 rounded-[6px] border border-border bg-surface-2/50 px-3 py-2 text-[11px]">
        <div>
          <div className="text-text-muted">Requests</div>
          <div className="num font-medium text-text-main">{usage.requests.toLocaleString()}</div>
        </div>
        <div>
          <div className="text-text-muted">Tokens</div>
          <div className="num font-medium text-text-main">{usage.tokensLabel}</div>
        </div>
      </div>

      <div className="flex items-center gap-3 border-t border-border pt-3 text-[11.5px] text-text-muted">
        <Link href={`/dashboard/providers/${connection.provider}`} className="flex items-center gap-1 hover:text-text-main">
          <span className="material-symbols-outlined text-[14px]">open_in_new</span>
          Details
        </Link>
        <Link href="/dashboard/quota" className="flex items-center gap-1 hover:text-text-main">
          <span className="material-symbols-outlined text-[14px]">data_usage</span>
          Quota
        </Link>
        <ResetButton info={resetInfo} onClick={onReset} busy={resetBusy} />
        {autoRedeem && <span className="ml-auto"><AutoRedeemSelect connection={connection} {...autoRedeem} /></span>}
      </div>
    </div>
  );
}

AccountCard.propTypes = {
  connection: PropTypes.object.isRequired,
  quota: PropTypes.object,
  loading: PropTypes.bool,
  usage: PropTypes.shape({ requests: PropTypes.number, tokensLabel: PropTypes.string }).isRequired,
  resetInfo: PropTypes.object,
  resetBusy: PropTypes.bool,
  onReset: PropTypes.func,
  autoRedeem: PropTypes.shape({ globalEnabled: PropTypes.bool, onChange: PropTypes.func, busy: PropTypes.bool }),
};
