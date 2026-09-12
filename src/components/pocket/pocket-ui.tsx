import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Circle, Clock3, XCircle } from "lucide-react";

import { cn } from "@/lib/utils";

export const pocketFieldClass = "pocket-field";
export const pocketPrimaryActionClass = "pocket-primary-action";
export const pocketSecondaryActionClass = "pocket-secondary-action";

export function PocketMark({ className }: { className?: string }) {
  return (
    <span className={cn("relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-[1.1rem] bg-[var(--pocket-brand-navy)] text-sm font-black tracking-[-0.08em] shadow-[0_3px_0_#071127]", className)} aria-hidden="true">
      <span className="text-white">C</span><span className="text-[var(--pocket-brand-green)]">BP</span>
    </span>
  );
}

export function PocketPageHeader({ id, eyebrow, title, description, action }: { id?: string; eyebrow: string; title: string; description?: string; action?: ReactNode }) {
  return (
    <header className="flex min-w-0 flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--pocket-action-primary)]">{eyebrow}</p>
        <h1 id={id} className="mt-2 text-[clamp(1.5rem,5vw,2rem)] font-semibold leading-tight tracking-tight text-[var(--pocket-ink)]">{title}</h1>
        {description ? <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--pocket-muted)]">{description}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 flex-wrap gap-2">{action}</div> : null}
    </header>
  );
}

const statusStyle = {
  success: "bg-emerald-50 text-emerald-800",
  warning: "bg-amber-50 text-amber-900",
  danger: "bg-red-50 text-red-800",
  neutral: "bg-slate-100 text-slate-700",
} as const;

const statusIcon = {
  success: CheckCircle2,
  warning: Clock3,
  danger: AlertTriangle,
  neutral: Circle,
} as const;

export function PocketStatusChip({ label, tone = "neutral", className }: { label: string; tone?: keyof typeof statusStyle; className?: string }) {
  const Icon = statusIcon[tone];
  return <span className={cn("pocket-status-chip", statusStyle[tone], className)}><Icon aria-hidden="true" className="size-3.5 shrink-0"/><span>{label}</span></span>;
}

export function PocketLoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" aria-label={label} className="mt-6 grid gap-3 sm:grid-cols-2">
      {[0, 1].map((item) => <div key={item} aria-hidden="true" className="pocket-card h-28 animate-pulse bg-white/70 motion-reduce:animate-none" />)}
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function PocketInlineError({ id, children }: { id?: string; children: ReactNode }) {
  return <div id={id} role="alert" className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-900"><XCircle aria-hidden="true" className="mt-0.5 size-5 shrink-0"/><span>{children}</span></div>;
}
