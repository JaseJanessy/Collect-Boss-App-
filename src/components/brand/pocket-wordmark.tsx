import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/utils";

type WordmarkVariant = "light" | "dark" | "monochrome";

interface CollectBossPocketWordmarkProps extends ComponentPropsWithoutRef<"span"> {
  variant?: WordmarkVariant;
  compact?: boolean;
}

/** Canonical Pocket wordmark: Collect in navy, Boss Pocket in green. */
export function CollectBossPocketWordmark({
  variant = "light",
  compact = false,
  className,
  ...props
}: CollectBossPocketWordmarkProps) {
  const monochrome = variant === "monochrome";

  return (
    <span
      aria-label="CollectBoss Pocket"
      data-brand-wordmark="collectboss-pocket"
      data-variant={variant}
      className={cn(
        "inline-flex w-fit shrink-0 items-baseline whitespace-nowrap font-black leading-none tracking-tight",
        variant === "dark" && "rounded-md bg-[var(--pocket-surface)] px-2.5 py-2",
        compact ? "text-lg" : "text-xl",
        className,
      )}
      {...props}
    >
      <span aria-hidden="true" className={monochrome ? "text-current" : "text-[var(--pocket-brand-navy)]"}>Collect</span>
      <span aria-hidden="true" className={monochrome ? "text-current" : "text-[var(--pocket-brand-green)]"}>Boss Pocket</span>
    </span>
  );
}
