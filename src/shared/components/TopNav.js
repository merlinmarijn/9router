"use client";

import { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/shared/utils/cn";
import { APP_CONFIG } from "@/shared/constants/config";
import { MEDIA_PROVIDER_KINDS } from "@/shared/constants/providers";
import useSettingsStore from "@/store/settingsStore";
import HeaderMenu from "./HeaderMenu";
import HeaderLanguage from "./HeaderLanguage";
import ThemeToggle from "./ThemeToggle";
import NineRemotePromoModal from "./NineRemotePromoModal";

// Same visible set as Sidebar so desktop + mobile navigation stay in sync
const VISIBLE_MEDIA_KINDS = ["embedding", "image", "video", "tts", "stt", "systemone"];

const primaryTabs = [
  { href: "/dashboard", label: "Dashboard", exact: true },
  { href: "/dashboard/endpoint", label: "Endpoint" },
  { href: "/dashboard/providers", label: "Providers" },
  { href: "/dashboard/combos", label: "Combos" },
  { href: "/dashboard/usage", label: "Usage" },
  { href: "/dashboard/quota", label: "Quota" },
  { href: "/dashboard/profile", label: "Settings" },
];

const toolItems = [
  { href: "/dashboard/token-saver", label: "Token Saver", icon: "savings" },
  { href: "/dashboard/cli-tools", label: "CLI Tools", icon: "terminal" },
  { href: "/dashboard/proxy-pools", label: "Proxy Pools", icon: "lan" },
  { href: "/dashboard/skills", label: "Skills", icon: "extension" },
  { href: "/dashboard/console-log", label: "Console Log", icon: "monitor" },
  { href: "/dashboard/translator", label: "Translator", icon: "translate", requiresTranslator: true },
];

const mediaItems = [
  ...MEDIA_PROVIDER_KINDS.filter((k) => VISIBLE_MEDIA_KINDS.includes(k.id)).map((k) => ({
    href: `/dashboard/media-providers/${k.id}`,
    label: k.label,
    icon: k.icon,
  })),
  { href: "/dashboard/media-providers/web", label: "Web Fetch & Search", icon: "travel_explore" },
];

function isTabActive(pathname, tab) {
  if (tab.exact) return pathname === tab.href;
  return pathname.startsWith(tab.href);
}

function NavDropdown({ label, items, pathname, extra }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const active = items.some((i) => pathname.startsWith(i.href));

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-7 items-center gap-0.5 rounded-[6px] px-3 text-[13px] font-medium transition-colors",
          active ? "bg-surface-3 text-text-main" : "text-text-muted hover:text-text-main"
        )}
      >
        {label}
        <span className="material-symbols-outlined text-[16px]">expand_more</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-[8px] border border-border bg-surface py-1 shadow-[var(--shadow-elev)]">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className={cn(
                "flex items-center gap-2.5 px-3 py-1.5 text-[13px] transition-colors",
                pathname.startsWith(item.href)
                  ? "bg-surface-2 text-text-main"
                  : "text-text-muted hover:bg-surface-2 hover:text-text-main"
              )}
            >
              <span className="material-symbols-outlined text-[16px]">{item.icon}</span>
              {item.label}
            </Link>
          ))}
          {extra}
        </div>
      )}
    </div>
  );
}

NavDropdown.propTypes = {
  label: PropTypes.string.isRequired,
  items: PropTypes.array.isRequired,
  pathname: PropTypes.string.isRequired,
  extra: PropTypes.node,
};

export default function TopNav({ onMenuClick }) {
  const pathname = usePathname() || "";
  const [enableTranslator, setEnableTranslator] = useState(false);
  const [showRemoteModal, setShowRemoteModal] = useState(false);

  useEffect(() => {
    useSettingsStore.getState().fetchSettings().then((data) => {
      if (data?.enableTranslator) setEnableTranslator(true);
    });
  }, []);

  const handleLogout = async () => {
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (res.ok) window.location.assign("/login");
    } catch (err) {
      console.error("Failed to logout:", err);
    }
  };

  const tools = toolItems.filter((i) => !i.requiresTranslator || enableTranslator);

  return (
    <header className="sticky top-0 z-30 shrink-0 border-b border-border bg-bg/85 backdrop-blur-md">
      <div className="mx-auto flex h-12 max-w-[1400px] items-center gap-3 px-4 lg:px-6">
        {/* Mobile menu */}
        <button
          type="button"
          onClick={onMenuClick}
          className="flex size-8 items-center justify-center rounded-[6px] text-text-muted hover:bg-surface-2 hover:text-text-main lg:hidden"
          aria-label="Open navigation"
        >
          <span className="material-symbols-outlined text-[20px]">menu</span>
        </button>

        {/* Brand */}
        <Link href="/dashboard" className="flex shrink-0 items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-full border border-border bg-surface-2">
            <span className="material-symbols-outlined text-[14px] text-text-main">hub</span>
          </span>
          <span className="text-[13px] font-semibold tracking-tight text-text-main">{APP_CONFIG.name}</span>
        </Link>

        {/* Center tabs */}
        <nav className="hidden flex-1 justify-center lg:flex">
          <div className="flex items-center gap-0.5 rounded-[8px] border border-border bg-surface p-0.5">
            {primaryTabs.map((tab) => (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  "flex h-7 items-center rounded-[6px] px-3 text-[13px] font-medium transition-colors",
                  isTabActive(pathname, tab)
                    ? "bg-surface-3 text-text-main"
                    : "text-text-muted hover:text-text-main"
                )}
              >
                {tab.label}
              </Link>
            ))}
            <NavDropdown label="Media" items={mediaItems} pathname={pathname} />
            <NavDropdown
              label="Advanced"
              items={tools}
              pathname={pathname}
              extra={
                <>
                  <div className="my-1 h-px bg-border" />
                  <button
                    type="button"
                    onClick={() => setShowRemoteModal(true)}
                    className="flex w-full items-center gap-2.5 px-3 py-1.5 text-[13px] text-text-muted transition-colors hover:bg-surface-2 hover:text-text-main"
                  >
                    <span className="material-symbols-outlined text-[16px]">computer</span>
                    9Remote
                  </button>
                  <a
                    href="https://9english.net/"
                    target="_blank"
                    rel="noreferrer"
                    className="flex w-full items-center gap-2.5 px-3 py-1.5 text-[13px] text-text-muted transition-colors hover:bg-surface-2 hover:text-text-main"
                  >
                    <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                    9English
                  </a>
                </>
              }
            />
          </div>
        </nav>

        {/* Right actions */}
        <div className="ml-auto flex shrink-0 items-center gap-0.5 lg:ml-0">
          <HeaderLanguage />
          <ThemeToggle />
          <HeaderMenu onLogout={handleLogout} />
          <button
            type="button"
            onClick={handleLogout}
            className="hidden h-8 items-center gap-1.5 rounded-[6px] px-2 text-[13px] text-text-muted transition-colors hover:bg-surface-2 hover:text-text-main sm:flex"
          >
            <span className="material-symbols-outlined text-[16px]">logout</span>
            Logout
          </button>
        </div>
      </div>
      <NineRemotePromoModal isOpen={showRemoteModal} onClose={() => setShowRemoteModal(false)} />
    </header>
  );
}

TopNav.propTypes = {
  onMenuClick: PropTypes.func,
};
