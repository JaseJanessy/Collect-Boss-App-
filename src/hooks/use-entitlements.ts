"use client";

/**
 * useEntitlements — loads the logged-in business's entitlement row and
 * exposes convenience flag functions.
 *
 * Grants no capabilities while loading or on failure. Sample entitlements
 * are available only through the explicitly enabled development data layer.
 */

import { useEffect, useState } from "react";
import type { EntitlementRow } from "@/lib/billing/types";
import type { EntitlementFlags } from "@/lib/billing/types";
import { getMyEntitlementClient } from "@/lib/billing/client";
import { getEntitlementFlags } from "@/lib/billing/entitlements";

interface UseEntitlementsResult {
  entitlement: EntitlementRow | null;
  flags:       EntitlementFlags;
  loading:     boolean;
  error:       string | null;
}

export function useEntitlements(): UseEntitlementsResult {
  const [entitlement, setEntitlement] = useState<EntitlementRow | null>(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    getMyEntitlementClient()
      .then((row) => {
        if (!cancelled) {
          setEntitlement(row);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load entitlements");
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, []);

  const flags = entitlement
    ? getEntitlementFlags(entitlement)
    : { canCreateCase: () => false, canExportEvidencePack: () => false, canUsePaymentLock: false, canUseFormalDemand: false, canUseLawyerReferral: false, canViewReports: false };

  return { entitlement, flags, loading, error };
}
