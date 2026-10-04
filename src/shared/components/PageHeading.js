"use client";

import { useMemo } from "react";
import PropTypes from "prop-types";
import Link from "next/link";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { translate } from "@/i18n/runtime";
import { getPageInfo, HeaderSearch } from "./Header";

// codex-lb style page title block: large title + muted description, actions on the right
export default function PageHeading({ pathname }) {
  const { title, description, breadcrumbs } = useMemo(() => getPageInfo(pathname), [pathname]);

  // The overview page renders its own heading row (with period selector)
  if (pathname === "/dashboard") return null;
  if (!title && breadcrumbs.length === 0) return null;

  const current = breadcrumbs[breadcrumbs.length - 1];

  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {breadcrumbs.length > 1 && (
          <div className="mb-1 flex items-center gap-1 text-xs text-text-muted">
            {breadcrumbs.slice(0, -1).map((crumb) => (
              <span key={`${crumb.label}-${crumb.href}`} className="flex items-center gap-1">
                <Link href={crumb.href} className="hover:text-text-main">{translate(crumb.label)}</Link>
                <span className="material-symbols-outlined text-[14px]">chevron_right</span>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          {current?.image && (
            <ProviderIcon
              src={current.image}
              alt={current.label}
              size={24}
              className="max-h-[24px] max-w-[24px] rounded object-contain"
              fallbackText={current.label.slice(0, 2).toUpperCase()}
            />
          )}
          <h1 className="truncate text-2xl font-semibold tracking-tight text-text-main">
            {translate(current?.label || title)}
          </h1>
        </div>
        {description && (
          <p className="mt-1 truncate text-[13px] text-text-muted">{translate(description)}</p>
        )}
      </div>
      <HeaderSearch />
    </div>
  );
}

PageHeading.propTypes = {
  pathname: PropTypes.string,
};
