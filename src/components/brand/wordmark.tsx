import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/utils";

type WordmarkVariant = "light" | "dark" | "monochrome";

interface CollectBossWordmarkProps extends ComponentPropsWithoutRef<"span"> {
  variant?: WordmarkVariant;
  compact?: boolean;
}

/**
 * Canonical Main wordmark. The dark-surface variant supplies a neutral clear-
 * space field so the approved navy/green identity never changes colour.
 */
export function CollectBossWordmark({
  variant = "light",
  compact = false,
  className,
  ...props
}: CollectBossWordmarkProps) {
  const monochrome = variant === "monochrome";

  return (
    <span
      aria-label="CollectBoss"
      data-brand-wordmark="collectboss-main"
      data-variant={variant}
      className={cn(
        "inline-flex w-fit shrink-0 items-baseline whitespace-nowrap font-black leading-none tracking-tight",
        variant === "dark" && "rounded-md bg-[var(--cb-surface)] px-2.5 py-2",
        compact ? "text-lg" : "text-xl",
        className,
      )}
      {...props}
    >
      <span aria-hidden="true" className={monochrome ? "text-current" : "text-[var(--cb-brand-navy)]"}>
        Collect
      </span>
      <span aria-hidden="true" className={monochrome ? "text-current" : "text-[var(--cb-brand-green)]"}>
        Boss
      </span>
    </span>
  );
}
