/**
 * CollectBoss Billing Types
 * Mirrors the tables in supabase/billing.sql.
 *
 * -1 in any *_limit field means unlimited.
 */

// ─── Enums ────────────────────────────────────────────────────────────────────

export type PlanSlug = "free" | "starter" | "boss" | "pro";

export type SubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "canceled"
  | "incomplete"
  | "incomplete_expired"
  | "unpaid"
  | "paused";

// ─── plans ────────────────────────────────────────────────────────────────────

export interface PlanRow {
  id:                      string;
  name:                    string;
  slug:                    PlanSlug;
  monthly_price_rm:        number;
  stripe_price_id:         string | null;
  case_limit:              number;          // -1 = unlimited
  evidence_pack_limit:     number;          // -1 = unlimited
  team_member_limit:       number;
  payment_lock_enabled:    boolean;
  formal_demand_enabled:   boolean;
  lawyer_referral_enabled: boolean;
  reports_enabled:         boolean;
  created_at:              string;
}

// ─── subscriptions ────────────────────────────────────────────────────────────

export interface SubscriptionRow {
  id:                     string;
  business_id:            string;
  stripe_customer_id:     string | null;
  stripe_subscription_id: string | null;
  stripe_price_id:        string | null;
  plan_slug:              PlanSlug;
  status:                 SubscriptionStatus;
  current_period_start:   string | null;   // ISO timestamptz
  current_period_end:     string | null;   // ISO timestamptz
  cancel_at_period_end:   boolean;
  created_at:             string;
  updated_at:             string;
}

/** Fields safe for a client-side upsert (only used by webhook server-side) */
export type SubscriptionUpsert = Omit<
  SubscriptionRow,
  "id" | "created_at" | "updated_at"
> & {
  id?:         string;
  created_at?: string;
  updated_at?: string;
};

// ─── billing_events ───────────────────────────────────────────────────────────

export interface BillingEventRow {
  id:              string;
  business_id:     string | null;
  stripe_event_id: string;
  event_type:      string;
  processed:       boolean;
  metadata:        Record<string, unknown> | null;
  status:           "pending" | "processing" | "retry_scheduled" | "succeeded" | "dead_letter";
  attempts:         number;
  next_attempt_at:  string;
  event_created_at: string | null;
  processed_at:     string | null;
  last_error_code:  string | null;
  last_error_message: string | null;
  created_at:      string;
}

export type BillingEventInsert = Omit<BillingEventRow, "id" | "created_at" | "status" | "attempts" | "next_attempt_at" | "event_created_at" | "processed_at" | "last_error_code" | "last_error_message"> & {
  id?:         string;
  created_at?: string;
  status?: BillingEventRow["status"];
  attempts?: number;
  next_attempt_at?: string;
  event_created_at?: string | null;
  processed_at?: string | null;
  last_error_code?: string | null;
  last_error_message?: string | null;
};

// ─── entitlements ─────────────────────────────────────────────────────────────

export interface EntitlementRow {
  id:                      string;
  business_id:             string;
  plan_slug:               PlanSlug;
  case_limit:              number;   // -1 = unlimited
  evidence_pack_limit:     number;   // -1 = unlimited
  team_member_limit:       number;
  extra_seats?:            number;   // paid add-on seats included in team_member_limit
  payment_lock_enabled:    boolean;
  formal_demand_enabled:   boolean;
  lawyer_referral_enabled: boolean;
  reports_enabled:         boolean;
  updated_at:              string;
}

export type EntitlementUpdate = Partial<
  Omit<EntitlementRow, "id" | "business_id">
>;

// ─── Convenience: feature flags from entitlement ──────────────────────────────

export interface EntitlementFlags {
  canCreateCase:         (currentCount: number) => boolean;
  canExportEvidencePack: (currentCount: number) => boolean;
  canUsePaymentLock:     boolean;
  canUseFormalDemand:    boolean;
  canUseLawyerReferral:  boolean;
  canViewReports:        boolean;
}
