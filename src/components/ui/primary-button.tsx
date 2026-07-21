"use client";

import { cn } from "@/lib/utils";
import type { ReactNode, ButtonHTMLAttributes } from "react";

interface PrimaryButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
  fullWidth?: boolean;
}

export function PrimaryButton({
  children,
  variant = "primary",
  size = "md",
  icon,
  fullWidth,
  className,
  ...props
}: PrimaryButtonProps) {
  const base =
    "inline-flex min-h-11 max-w-full items-center justify-center gap-2 text-center leading-snug whitespace-normal font-semibold rounded-xl transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed";

  const variants = {
    primary: "bg-[#55DDB4] text-[#0B1B3A] hover:bg-[#8BE4CA] shadow-sm shadow-[#55DDB4]/20",
    secondary:
      "bg-[#173361] text-white border border-[#244777] hover:bg-[#244777] shadow-sm",
    ghost: "bg-transparent text-[#8BE4CA] hover:bg-[#173361]",
    danger: "bg-red-600 text-white hover:bg-red-700 shadow-sm",
  };

  const sizes = {
    sm: "text-xs px-3 py-2",
    md: "text-sm px-4 py-3",
    lg: "text-base px-6 py-4",
  };

  return (
    <button
      className={cn(
        base,
        variants[variant],
        sizes[size],
        fullWidth && "w-full",
        className
      )}
      {...props}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      {children}
    </button>
  );
}
