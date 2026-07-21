"use client";

/**
 * useSubscription — loads the logged-in business's subscription row.
 * Complements useEntitlements (which loads what the business *can* do).
 * This hook loads the billing metadata (status, period, Stripe IDs).
 */

import { useCallback, useEffect, useState } from "react";
import type { SubscriptionRow } from "@/lib/billing/types";
import { getMySubscriptionClient } from "@/lib/billing/client";

interface State {
  subscription: SubscriptionRow | null;
  loading:      boolean;
  error:        string | null;
}

interface UseSubscriptionResult extends State {
  refresh: () => void;
}

export function useSubscription(): UseSubscriptionResult {
  const [state, setState] = useState<State>({
    subscription: null,
    loading:      true,
    error:        null,
  });
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;

    getMySubscriptionClient()
      .then((row) => {
        if (!cancelled) {
          setState({ subscription: row, loading: false, error: null });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({
            subscription: null,
            loading:      false,
            error:        err instanceof Error ? err.message : "Failed to load subscription",
          });
        }
      });

    return () => { cancelled = true; };
  }, [tick]);

  return { ...state, refresh };
}
