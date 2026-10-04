"use client";

import { cn } from "@/shared/utils/cn";

const variants = {
  primary: "bg-primary hover:bg-primary-hover text-primary-fg disabled:bg-surface-3 disabled:text-text-muted",
  secondary: "bg-surface-2 hover:bg-surface-3 text-text-main border border-border disabled:opacity-50",
  outline: "border border-border bg-transparent text-text-main hover:bg-surface-2",
  ghost: "text-text-muted hover:bg-surface-2 hover:text-text-main",
  danger: "bg-red-600 hover:bg-red-700 text-white disabled:bg-surface-3 disabled:text-text-muted",
  success: "bg-green-600 hover:bg-green-700 text-white disabled:bg-surface-3 disabled:text-text-muted",
};

const sizes = {
  sm: "h-7 px-2.5 text-xs rounded-[6px]",
  md: "h-8 px-3.5 text-[13px] rounded-[6px]",
  lg: "h-10 px-5 text-sm rounded-[6px]",
};

export default function Button({
  children,
  variant = "primary",
  size = "md",
  icon,
  iconRight,
  disabled = false,
  loading = false,
  fullWidth = false,
  className,
  ...props
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-1.5 font-medium transition-colors duration-150 ease-out cursor-pointer",
        "active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100",
        variants[variant],
        sizes[size],
        fullWidth && "w-full",
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <span className="material-symbols-outlined animate-spin text-[16px]">progress_activity</span>
      ) : icon ? (
        <span className="material-symbols-outlined text-[16px]">{icon}</span>
      ) : null}
      {children}
      {iconRight && !loading && (
        <span className="material-symbols-outlined text-[16px]">{iconRight}</span>
      )}
    </button>
  );
}
