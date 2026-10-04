"use client";

import { cn } from "@/shared/utils/cn";

const variants = {
  default: "bg-surface-2 text-text-muted border-border",
  primary: "bg-surface-2 text-text-main border-border",
  success: "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/25",
  warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25",
  error: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/25",
  info: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/25",
};

const sizes = {
  sm: "px-2 py-0.5 text-[10px]",
  md: "px-2.5 py-1 text-xs",
  lg: "px-3 py-1.5 text-sm",
};

export default function Badge({
  children,
  variant = "default",
  size = "md",
  dot = false,
  icon,
  className,
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-medium",
        variants[variant],
        sizes[size],
        className
      )}
    >
      {dot && (
        <span
          className={cn(
            "size-1.5 rounded-full",
            variant === "success" && "bg-green-500",
            variant === "warning" && "bg-amber-500",
            variant === "error" && "bg-red-500",
            variant === "info" && "bg-blue-500",
            variant === "primary" && "bg-text-main",
            variant === "default" && "bg-text-subtle"
          )}
        />
      )}
      {icon && <span className="material-symbols-outlined text-[14px]">{icon}</span>}
      {children}
    </span>
  );
}
