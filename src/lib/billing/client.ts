/**
 * Billing client helpers — browser-side reads for the logged-in user's
 * subscription and entitlements.
 *
 * All writes to billing tables are reserved for the Stripe webhook
 * (server-side, service role). These helpers are read-only.
 */

import { getBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { SubscriptionRow, EntitlementRow } from "./types";
import { FREE_ENTITLEMENT_MOCK } from "./plans";

// ─── Internal helper ─────────────────────────────────────────────────────────

async function getBusinessId(): Promise<string | null> {
  const client = getBrowserClient();
  if (!client) return null;

  const { data: { user } } = await client.auth.getUser();
  if (!user) return null;

  const { data, error } = await client.rpc("my_business_id");
  if (error) throw new Error("Your workspace plan could not be verified. Please retry.");
  return typeof data === "string" ? data : null;
}

// ─── Subscription ─────────────────────────────────────────────────────────────

/**
 * Returns the current user's subscription row, or null if not found.
 * Falls back to a synthetic free subscription in mock mode.
 */
export async function getMySubscriptionClient(): Promise<SubscriptionRow | null> {
  if (!isSupabaseConfigured) {
    // Mock mode: synthesise a free subscription
    return {
      id:                     "sub-mock-free",
      business_id:            "mock-business-id",
      stripe_customer_id:     null,
      stripe_subscription_id: null,
      stripe_price_id:        null,
      plan_slug:              "free",
      status:                 "active",
      current_period_start:   null,
      current_period_end:     null,
      cancel_at_period_end:   false,
      created_at:             new Date().toISOString(),
      updated_at:             new Date().toISOString(),
    };
  }

  const client = getBrowserClient();
  if (!client) return null;

  const businessId = await getBusinessId();
  if (!businessId) return null;

  const { data, error } = await client
    .from("subscriptions")
    .select("*")
    .eq("business_id", businessId)
    .maybeSingle();

  if (error) {
    throw new Error("Your subscription could not be loaded. Please retry.");
  }

  return data as SubscriptionRow | null;
}

// ─── Entitlements ─────────────────────────────────────────────────────────────

/**
 * Returns the current user's entitlement row.
 * Falls back to the free-tier mock when Supabase is not configured.
 */
export async function getMyEntitlementClient(): Promise<EntitlementRow> {
  if (!isSupabaseConfigured) {
    return FREE_ENTITLEMENT_MOCK;
  }

  const client = getBrowserClient();
  if (!client) throw new Error("Account access is unavailable.");

  const businessId = await getBusinessId();
  if (!businessId) throw new Error("Choose or join a workspace to view your plan.");

  const { data, error } = await client
    .from("entitlements")
    .select("*")
    .eq("business_id", businessId)
    .maybeSingle();

  if (error) {
    throw new Error("Your plan permissions could not be loaded. Please retry.");
  }

  if (!data) throw new Error("Your workspace plan is still being prepared. Please retry.");
  return data as EntitlementRow;
}
