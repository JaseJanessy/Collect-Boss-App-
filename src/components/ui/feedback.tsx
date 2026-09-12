import * as React from "react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info, LockKeyhole, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

type AlertTone = "info" | "success" | "warning" | "error";
const alertStyles: Record<AlertTone, { icon: typeof Info; classes: string }> = {
  info: { icon: Info, classes: "border-blue-300 bg-blue-50 text-blue-950" },
  success: { icon: CheckCircle2, classes: "border-emerald-300 bg-emerald-50 text-emerald-950" },
  warning: { icon: AlertTriangle, classes: "border-amber-300 bg-amber-50 text-amber-950" },
  error: { icon: AlertCircle, classes: "border-red-300 bg-red-50 text-red-950" },
};

function Alert({ tone = "info", title, children, action, className }: {
  tone?: AlertTone;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  const style = alertStyles[tone];
  const Icon = style.icon;
  return (
    <div data-slot="alert" role={tone === "error" ? "alert" : "status"} className={cn("flex min-w-0 items-start gap-3 rounded-xl border p-4 text-sm", style.classes, className)}>
      <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-bold">{title}</p>
        {children ? <div className="mt-1 text-sm leading-relaxed opacity-90">{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

function PermissionDeniedState({ action }: { action?: React.ReactNode }) {
  return <EmptyState icon={<LockKeyhole className="size-6" />} title="Permission required" description="Your current role does not allow this action. Ask an administrator if you need access." action={action} />;
}

function OfflineState({ onRetry }: { onRetry?: () => void }) {
  return <EmptyState announce icon={<WifiOff className="size-6" />} title="You appear to be offline" description="Reconnect to the internet, then try again." action={onRetry ? <Button onClick={onRetry}>Try again</Button> : undefined} />;
}

function ErrorState({ title = "Something went wrong", description = "We could not load this content.", onRetry }: { title?: string; description?: string; onRetry?: () => void }) {
  return <EmptyState announce icon={<AlertCircle className="size-6" />} title={title} description={description} action={onRetry ? <Button onClick={onRetry}>Try again</Button> : undefined} />;
}

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div aria-hidden="true" data-slot="skeleton" className={cn("cb-skeleton", className)} {...props} />;
}

function LoadingState({ label = "Loading content", rows = 3, className }: { label?: string; rows?: number; className?: string }) {
  return (
    <div role="status" aria-label={label} className={cn("cb-surface space-y-4 p-5", className)}>
      <span className="sr-only">{label}</span>
      <Skeleton className="h-5 w-1/3" />
      {Array.from({ length: rows }, (_, index) => <Skeleton key={index} className="h-12 w-full" />)}
    </div>
  );
}

export { Alert, ErrorState, LoadingState, OfflineState, PermissionDeniedState, Skeleton };
export type { AlertTone };
