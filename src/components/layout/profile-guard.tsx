"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { isMockBusinessComplete } from "@/lib/auth/mock-session";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import type { ReactNode } from "react";

// Routes that don't need a complete business profile
const PROFILE_EXEMPT = ["/onboarding", "/login", "/signup", "/forgot-password", "/reset-password", "/pay", "/landing", "/beta-welcome", "/dev", "/terms", "/privacy", "/legal-disclaimer", "/pdpa-consent", "/support"];

interface Props {
  children: ReactNode;
}

export function ProfileGuard({ children }: Props) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [profileChecked, setProfileChecked] = useState(false);

  const isExempt = PROFILE_EXEMPT.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );

  useEffect(() => {
    void (async () => {
      if (loading || isExempt || !user) {
        setProfileChecked(true);
        return;
      }

      if (!isSupabaseConfigured) {
        const complete = isMockBusinessComplete();
        if (!complete) router.push("/onboarding/profile");
        setProfileChecked(true);
        return;
      }

      const response = await fetch("/api/profile", { cache: "no-store" });
      const payload = await response.json().catch(() => ({ profile: null })) as {
        profile?: { accountType?: string | null; legalName?: string | null; contactName?: string | null } | null;
      };
      const profile = payload.profile;
      const complete = response.ok && !!profile?.accountType && !!profile.legalName && !!profile.contactName;
      if (!complete) router.push("/onboarding/profile");
      setProfileChecked(true);
    })();
  }, [user, loading, pathname, isExempt, router]);

  // Show nothing while checking (no flash)
  if (!profileChecked || loading) {
    return (
      <div className="min-h-screen bg-[#F2F4F7] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <span className="text-xl font-black text-[#0D1B3D]">
            Collect<span className="text-[#009966]">Boss</span>
          </span>
          <div className="w-5 h-5 border-2 border-[#009966] border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
