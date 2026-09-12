"use client";

/**
 * Shows an amber "TEST MODE" badge when the app is not running in production.
 * Hidden completely when NEXT_PUBLIC_APP_ENV === "production".
 *
 * Place this wherever the environment mode should be visible to developers and
 * testers — currently rendered in the sidebar (desktop) and mobile header.
 */

const appEnv = process.env.NEXT_PUBLIC_APP_ENV;
const isProduction = appEnv === "production";

/** Inline badge — use inside a flex row alongside other elements. */
export function EnvModeBadge() {
  if (isProduction) return null;

  const label = appEnv === "staging" ? "STAGING" : "TEST MODE";

  return (
    <span className="inline-flex items-center gap-1 text-[9px] font-bold text-amber-300 bg-amber-900/40 border border-amber-700/30 px-1.5 py-0.5 rounded-full tracking-wide">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
      {label}
    </span>
  );
}

/** Pill shown at the top of the sidebar, below the wordmark — desktop only. */
export function SidebarEnvBadge() {
  if (isProduction) return null;

  const label = appEnv === "staging" ? "STAGING" : "STRIPE TEST MODE";

  return (
    <div
      aria-label={`${label}. Using Stripe test keys. Real payments are not processed.`}
      title={label}
      className="mx-2 mt-2 mb-1 rounded-xl border border-amber-700/30 bg-amber-900/20 px-1.5 py-2 lg:mx-3 lg:px-3"
    >
      <div className="flex items-center justify-center gap-1.5 lg:justify-start">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
        <span className="hidden text-[10px] font-bold tracking-wide text-amber-300 lg:inline">{label}</span>
      </div>
      <p className="mt-0.5 hidden text-[9px] leading-relaxed text-amber-400/70 lg:block">
        Using Stripe test keys. Real payments are not processed.
      </p>
    </div>
  );
}
