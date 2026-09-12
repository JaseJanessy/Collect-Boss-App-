"use client";

import { cn } from "@/lib/utils";
import type { ReactNode, ButtonHTMLAttributes } from "react";
import { buttonVariants } from "@/components/ui/button";

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
  const variants = {
    primary: buttonVariants({ variant: "default" }),
    secondary: buttonVariants({ variant: "secondary" }),
    ghost: buttonVariants({ variant: "ghost" }),
    danger: buttonVariants({ variant: "destructive" }),
  };

  const sizes = {
    sm: "min-h-9 px-3 py-2 text-xs",
    md: "min-h-11 px-4 py-2.5 text-sm",
    lg: "min-h-12 px-5 py-3 text-base",
  };

  return (
    <button
      className={cn(
        "max-w-full whitespace-normal text-center leading-snug",
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
