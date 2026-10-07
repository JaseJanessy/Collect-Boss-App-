"use client";
import { friendlyErrorMessage } from "@/lib/ui/friendly-error";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useAuth } from "@/hooks/use-auth";
import { emptyStructuredAddress } from "@/lib/international/address";
import { LEGACY_MALAYSIA_REGION } from "@/lib/international/registry";
import type { RegionConfigurationDto } from "@/lib/international/types";
import { isSupabaseConfigured } from "@/lib/supabase/client";

const legacyConfiguration: RegionConfigurationDto = {
  settings: LEGACY_MALAYSIA_REGION,
  address: emptyStructuredAddress("MY"),
  phoneDisplay: null,
  phoneE164: null,
  registrationIdentifiers: [],
  defaultsSource: "legacy_malaysia_v1",
  defaultsDeterminedAt: new Date(0).toISOString(),
  canManage: false,
};

interface RegionContextValue {
  configuration: RegionConfigurationDto;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const RegionContext = createContext<RegionContextValue | null>(null);

export function RegionProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [loaded, setLoaded] = useState<RegionConfigurationDto>(legacyConfiguration);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user || !isSupabaseConfigured) return;
    setLoading(true);
    try {
      const response = await fetch("/api/region-settings", { cache: "no-store" });
      const payload = await response.json().catch(() => ({})) as { configuration?: RegionConfigurationDto; error?: string };
      if (!response.ok || !payload.configuration) throw new Error(friendlyErrorMessage(payload.error ?? "Unable to load region settings."));
      setLoaded(payload.configuration);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load region settings.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading || !user || !isSupabaseConfigured) return;
    const timeoutId = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [authLoading, refresh, user]);

  const configuration = user ? loaded : legacyConfiguration;
  useEffect(() => {
    document.documentElement.lang = configuration.settings.locale;
  }, [configuration.settings.locale]);

  const value = useMemo(() => ({ configuration, loading, error, refresh }), [configuration, loading, error, refresh]);
  return <RegionContext.Provider value={value}>{children}</RegionContext.Provider>;
}

export function useRegion() {
  const value = useContext(RegionContext);
  if (!value) throw new Error("useRegion must be used inside RegionProvider.");
  return value;
}
