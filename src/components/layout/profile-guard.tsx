"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { isMockBusinessComplete } from "@/lib/auth/mock-session";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import type { ReactNode } from "react";
import { CollectBossWordmark } from "@/components/brand/wordmark";

// Routes that don't need a complete business profile
const PROFILE_EXEMPT = ["/", "/pocket", "/onboarding", "/login", "/signup", "/choose-product", "/forgot-password", "/reset-password", "/pay", "/acknowledge", "/workspace-unavailable", "/landing", "/dev", "/terms", "/privacy", "/legal-disclaimer", "/pdpa-consent", "/support", "/status", "/glossary"];

interface Props {
  children: ReactNode;
}

export function ProfileGuard({ children }: Props) {
  const { user, loading, initializationError } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [profileResult, setProfileResult] = useState<{
    key: string;
    error: string | null;
  } | null>(null);

  const isExempt = PROFILE_EXEMPT.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
  const requiredProfileKey = !isExempt && !loading && user
    ? `${pathname}:${user.id}`
    : null;

  useEffect(() => {
    if (!requiredProfileKey || !user) return;

    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8_000);

    void (async () => {
      if (!isSupabaseConfigured) {
        const complete = isMockBusinessComplete();
        if (!complete) router.push("/onboarding/profile");
        return;
      }

      try {
        const response = await fetch("/api/profile", {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => ({ profile: null })) as {
          profile?: { accountType?: string | null; legalName?: string | null; contactName?: string | null } | null;
        };
        const profile = payload.profile;
        if (!response.ok) throw new Error("Business profile verification is unavailable.");
        const complete = response.ok && !!profile?.accountType && !!profile.legalName && !!profile.contactName;
        if (!complete) router.push("/onboarding/profile");
      } catch {
        if (active) {
          setProfileResult({
            key: requiredProfileKey,
            error: "CollectBoss could not verify your business profile. Please retry.",
          });
        }
      }
    })().finally(() => {
      window.clearTimeout(timeout);
      if (active) {
        setProfileResult((current) => current?.key === requiredProfileKey && current.error
          ? current
          : { key: requiredProfileKey, error: null });
      }
    });

    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [requiredProfileKey, user, router]);

  // Public and capability-token routes must never wait for account auth/profile
  // initialization. Their own route components enforce any token validation.
  if (isExempt) return <>{children}</>;

  const profileChecked = requiredProfileKey === null || profileResult?.key === requiredProfileKey;
  const profileError = profileResult?.key === requiredProfileKey ? profileResult.error : null;
  const startupError = initializationError ?? profileError;
  if (startupError) {
    return (
      <div className="min-h-screen bg-[#F2F4F7] flex items-center justify-center px-5">
        <div role="alert" className="w-full max-w-md rounded-2xl border border-red-200 bg-white p-6 text-center shadow-sm">
          <CollectBossWordmark className="mx-auto" />
          <h1 className="mt-5 text-lg font-black text-[#0D1B3D]">We could not start CollectBoss</h1>
          <p className="mt-2 text-sm leading-6 text-gray-600">{startupError}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 min-h-11 rounded-xl bg-[#009966] px-5 py-2.5 text-sm font-bold text-white hover:bg-[#00B377]"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Show nothing while checking (no flash)
  if (!profileChecked || loading) {
    return (
      <div className="min-h-screen bg-[#F2F4F7] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <CollectBossWordmark />
          <div className="w-5 h-5 border-2 border-[#009966] border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
