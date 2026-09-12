import { cn } from "@/lib/utils";
import { CollectBossWordmark } from "@/components/brand/wordmark";

export function LoadingSpinner({ className }: { className?: string }) {
  return (
    <div role="status" aria-live="polite" className={cn("flex items-center justify-center py-12", className)}>
      <div className="flex flex-col items-center gap-3">
        <CollectBossWordmark compact />
        <div aria-hidden="true" className="size-5 animate-spin rounded-full border-2 border-primary border-t-transparent motion-reduce:animate-none" />
        <span className="sr-only">Loading</span>
      </div>
    </div>
  );
}

export function InlineSpinner({ className }: { className?: string }) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={cn(
        "size-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none",
        className
      )}
    />
  );
}
