"use client";

/**
 * useCustomerPortal — calls the portal session API and redirects to Stripe.
 * The portal allows the user to update payment method, cancel, or view invoices.
 */

import { useState } from "react";

interface UseCustomerPortalResult {
  openPortal: () => Promise<void>;
  loading:    boolean;
  error:      string | null;
}

export function useCustomerPortal(): UseCustomerPortalResult {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  async function openPortal() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/billing/create-customer-portal-session", {
        method: "POST",
      });

      const data: { url?: string; error?: string } = await res.json();

      if (!res.ok || !data.url) {
        setError(data.error ?? "Could not open billing portal. Please try again.");
        setLoading(false);
        return;
      }

      // Full page redirect to Stripe Customer Portal
      window.location.href = data.url;
      // Keep loading=true — page will navigate away
    } catch {
      setError("Network error. Please check your connection and try again.");
      setLoading(false);
    }
  }

  return { openPortal, loading, error };
}
