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
    "inline-flex items-center justify-center gap-2 font-semibold rounded-xl transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed";

  const variants = {
    primary: "bg-[#009966] text-white hover:bg-[#00B377] shadow-sm",
    secondary:
      "bg-white text-[#0D1B3D] border border-gray-200 hover:bg-gray-50 shadow-sm",
    ghost: "bg-transparent text-[#009966] hover:bg-emerald-50",
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
