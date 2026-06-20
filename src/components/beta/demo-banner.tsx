"use client";

/**
 * DemoBanner — shown when the app is running without a real Supabase database.
 * Dismissible. Stored in localStorage via BetaContext.
 */

import { useBeta } from "@/contexts/beta-context";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { FlaskConical, X } from "lucide-react";

export function DemoBanner() {
  const { isDemoMode, dismissDemoMode } = useBeta();

  // Only show when Supabase is NOT configured (true demo mode) and not dismissed
  if (isSupabaseConfigured || !isDemoMode) return null;

  return (
    <div className="flex items-center gap-3 bg-amber-50 border-b border-amber-200 px-4 py-2.5">
      <FlaskConical className="w-4 h-4 text-amber-500 shrink-0" />
      <p className="flex-1 text-xs text-amber-800 font-medium leading-snug">
        <span className="font-bold">Demo mode</span> — you&apos;re viewing sample data.
        Connect Supabase in your environment to use live data.
      </p>
      <button
        onClick={dismissDemoMode}
        aria-label="Dismiss demo banner"
        className="w-5 h-5 flex items-center justify-center rounded-full hover:bg-amber-200 transition-colors shrink-0"
      >
        <X className="w-3 h-3 text-amber-600" />
      </button>
    </div>
  );
}
