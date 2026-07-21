"use client";

import { useCallback, useEffect, useState } from "react";
import type { BusinessProfileDto } from "@/lib/business-profile/types";
import { isSupabaseConfigured } from "@/lib/supabase/client";

async function fetchProfile(): Promise<BusinessProfileDto | null> {
  const response = await fetch("/api/profile", { cache: "no-store" });
  const payload = await response.json().catch(() => ({ profile: null, error: "Unable to load your profile." })) as {
    profile?: BusinessProfileDto | null;
    error?: string;
  };
  if (!response.ok) throw new Error(payload.error ?? "Unable to load your profile.");
  return payload.profile ?? null;
}

export function useBusinessProfile() {
  const [profile, setProfile] = useState<BusinessProfileDto | null>(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      setProfile(await fetchProfile());
      setError(null);
    } catch (error) {
      setProfile(null);
      setError(error instanceof Error ? error.message : "Unable to load your profile. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    let active = true;
    void fetchProfile()
      .then((loadedProfile) => {
        if (active) {
          setProfile(loadedProfile);
          setError(null);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setProfile(null);
          setError(error instanceof Error ? error.message : "Unable to load your profile. Check your connection and try again.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, []);

  return { profile, loading, error, refresh };
}
