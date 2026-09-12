"use client";

import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import { Eye, EyeOff, AlertCircle, CheckCircle2, ArrowRight } from "lucide-react";
import { CollectBossWordmark } from "@/components/brand/wordmark";

interface AuthShellProps {
  children: ReactNode;
  /** Shown below the wordmark on mobile */
  maxWidth?: "sm" | "md";
}

/** Shared outer wrapper for all auth pages */
export function AuthShell({ children, maxWidth = "sm" }: AuthShellProps) {
  const widthClass = maxWidth === "sm" ? "max-w-md" : "max-w-lg";
  return (
    <div className="cb-auth-shell min-h-[100dvh] bg-[var(--cb-background)] lg:grid lg:grid-cols-[minmax(20rem,0.85fr)_minmax(0,1.15fr)]">
      <aside className="hidden flex-col justify-between bg-[var(--cb-brand-navy)] px-10 py-10 text-white lg:flex xl:px-16">
        <Link href="/landing" className="w-fit" aria-label="CollectBoss home"><CollectBossWordmark variant="dark" /></Link>
        <div className="my-16 max-w-md">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-emerald-300">Business receivables, organised</p>
          <h2 className="mt-6 text-4xl font-medium leading-[1.18] xl:text-5xl">Clarity for every outstanding payment.</h2>
          <p className="mt-6 text-base leading-7 text-slate-300">A focused place to record what is owed, manage follow-ups and keep payment records in order.</p>
          <ol className="mt-10 divide-y divide-white/15 border-y border-white/15">
            {["Record the details", "Follow up professionally", "Reconcile payments"].map((step, index) => <li key={step} className="flex items-center gap-4 py-4 text-sm"><span className="font-mono text-xs text-emerald-300">0{index + 1}</span>{step}</li>)}
          </ol>
        </div>
        <div className="max-w-md">
          <p className="text-sm font-medium">One sign-in. The workspace that fits your business.</p>
          <p className="mt-2 text-sm leading-6 text-slate-300">Main for structured collections and team workflows. Pocket for a simpler day-to-day debt ledger.</p>
          <Link href="/landing#products" className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm text-emerald-300 hover:text-white">Compare Main and Pocket <ArrowRight aria-hidden="true" className="size-4" /></Link>
        </div>
      </aside>
      <div className="flex min-w-0 flex-col">
        <header className="flex min-h-20 items-center justify-between gap-4 border-b border-[var(--cb-divider)] px-6 lg:justify-end lg:border-0 lg:px-10">
          <Link href="/landing" className="lg:hidden"><CollectBossWordmark compact /></Link>
          <nav aria-label="Account help" className="flex items-center gap-5 text-sm text-[var(--cb-text-secondary)]">
            <Link href="/status" className="hidden min-h-11 items-center hover:text-[var(--cb-text-primary)] sm:inline-flex">System status</Link>
            <Link href="/support" className="inline-flex min-h-11 items-center hover:text-[var(--cb-text-primary)]">Help & support</Link>
          </nav>
        </header>
        <main className="flex flex-1 items-center justify-center px-5 py-10 sm:px-8 lg:py-12">
          <div className={`w-full ${widthClass}`}>{children}</div>
        </main>
        <footer className="flex flex-wrap justify-center gap-x-5 gap-y-2 px-5 py-6 text-xs text-[var(--cb-text-secondary)]">
          <span>© {new Date().getFullYear()} CollectBoss</span><Link href="/privacy" className="underline-offset-4 hover:underline">Privacy</Link><Link href="/terms" className="underline-offset-4 hover:underline">Terms</Link>
        </footer>
      </div>
    </div>
  );
}

/** White card used in all auth forms */
export function AuthCard({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--cb-border)] bg-white p-6 shadow-[0_2px_8px_rgb(13_27_61_/_0.03)] sm:p-8">
      {children}
    </div>
  );
}

/** Reusable text field for auth forms */
export function AuthField({
  label,
  type = "text",
  placeholder,
  value,
  onChange,
  error,
  icon,
  hint,
  autoComplete,
}: {
  label: string;
  type?: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  icon?: ReactNode;
  hint?: string;
  autoComplete?: string;
}) {
  const fieldId = useId();
  const [passwordVisible, setPasswordVisible] = useState(false);
  const isPassword = type === "password";
  const resolvedType = isPassword && passwordVisible ? "text" : type;
  const visibilityTarget = label.toLowerCase() === "confirm password"
    ? "password confirmation"
    : label.toLowerCase();
  const errorId = `${fieldId}-error`;
  const hintId = `${fieldId}-hint`;
  const describedBy = error ? errorId : hint ? hintId : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={fieldId} className="text-sm font-medium text-gray-700">{label}</label>
      <div className="relative">
        {icon && (
          <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
            {icon}
          </div>
        )}
        <input
          id={fieldId}
          type={resolvedType}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={`cb-field ${icon ? "cb-field-with-icon" : ""} ${isPassword ? "pr-12" : ""} ${error ? "border-red-500" : ""}`}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setPasswordVisible((visible) => !visible)}
            aria-label={passwordVisible ? `Hide ${visibilityTarget}` : `Show ${visibilityTarget}`}
            aria-pressed={passwordVisible}
            className="absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007A52]"
          >
            {passwordVisible ? <EyeOff aria-hidden="true" className="h-4 w-4" /> : <Eye aria-hidden="true" className="h-4 w-4" />}
          </button>
        )}
      </div>
      {error && <p id={errorId} className="text-xs text-red-500 ml-1">{error}</p>}
      {hint && !error && <p id={hintId} className="text-[11px] text-gray-400 ml-1">{hint}</p>}
    </div>
  );
}

/** Inline error banner */
export function AuthError({ message }: { message: string }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700">
      <AlertCircle aria-hidden="true" className="mt-1 size-4 shrink-0" />{message}
    </div>
  );
}

/** Inline success banner */
export function AuthSuccess({ message }: { message: string }) {
  return (
    <div role="status" className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-700">
      <CheckCircle2 aria-hidden="true" className="mt-1 size-4 shrink-0" />{message}
    </div>
  );
}
