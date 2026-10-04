"use client";

import { useEffect, useState } from "react";
import { APP_CONFIG, UPDATER_CONFIG } from "@/shared/constants/config";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import useSettingsStore from "@/store/settingsStore";

const HEALTH_POLL_MS = 30000;

const STRATEGY_LABELS = {
  fallback: "Fallback",
  "round-robin": "Round robin",
  fusion: "Fusion",
};

function formatStrategy(settings) {
  if (!settings) return "—";
  const parts = [STRATEGY_LABELS[settings.comboStrategy] || settings.comboStrategy || "Fallback"];
  if (settings.sessionAffinity && settings.sessionAffinity !== "disabled") {
    parts.push(`Sticky (${settings.sessionAffinity})`);
  }
  return parts.join(" + ");
}

function Dot({ ok }) {
  return <span className={`size-1.5 rounded-full ${ok ? "bg-green-500" : "bg-red-500"}`} />;
}

export default function StatusFooter() {
  const [healthy, setHealthy] = useState(true);
  const [checkedAt, setCheckedAt] = useState(null);
  const [updateInfo, setUpdateInfo] = useState(null);
  const settings = useSettingsStore((s) => s.settings);
  const { copied, copy } = useCopyToClipboard(2000);

  useEffect(() => {
    useSettingsStore.getState().fetchSettings();
    let cancelled = false;
    const check = () => {
      fetch("/api/health", { cache: "no-store" })
        .then((r) => { if (!cancelled) setHealthy(r.ok); })
        .catch(() => { if (!cancelled) setHealthy(false); })
        .finally(() => { if (!cancelled) setCheckedAt(new Date()); });
    };
    check();
    const timer = setInterval(check, HEALTH_POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  // Lazy npm version check (mirrors Sidebar) so desktop still surfaces updates
  useEffect(() => {
    const timer = setTimeout(() => {
      fetch("/api/version")
        .then((res) => res.json())
        .then((data) => { if (data.hasUpdate) setUpdateInfo(data); })
        .catch(() => {});
    }, 2500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <footer className="shrink-0 border-t border-border bg-bg">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-5 gap-y-1 px-4 py-2 text-[11px] text-text-muted lg:px-6">
        <span className="flex items-center gap-1.5">
          <Dot ok={healthy} />
          <span className="font-medium text-text-main">Service ready:</span>
          {healthy ? "Ready" : "Unreachable"}
        </span>
        {checkedAt && (
          <span className="flex items-center gap-1.5">
            <Dot ok={healthy} />
            <span className="font-medium text-text-main">Last check:</span>
            <span className="num">{checkedAt.toLocaleTimeString()}</span>
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[13px]">alt_route</span>
          <span className="font-medium text-text-main">Routing:</span>
          {formatStrategy(settings)}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[13px]">sell</span>
          <span className="font-medium text-text-main">Version:</span>
          <span className="num">{APP_CONFIG.version}</span>
        </span>
        {updateInfo && (
          <button
            type="button"
            onClick={() => copy(UPDATER_CONFIG.installCmdLatest)}
            title={UPDATER_CONFIG.installCmdLatest}
            className="flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-amber-500 hover:bg-amber-500/20"
          >
            <span className="material-symbols-outlined text-[13px]">upgrade</span>
            {copied ? "Install command copied" : `v${updateInfo.latestVersion} available — copy install command`}
          </button>
        )}
      </div>
    </footer>
  );
}
