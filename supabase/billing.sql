-- ─────────────────────────────────────────────────────────────────────────────
-- CollectBoss Billing Schema
-- Run this AFTER schema.sql (businesses table must exist).
--
-- Tables:  plans · subscriptions · billing_events · entitlements
-- Security:
--   • plans          — public SELECT (anyone can read plan definitions)
--   • subscriptions  — authenticated owner SELECT only; INSERT/UPDATE via service role
--   • billing_events — service role only (no client access)
--   • entitlements   — authenticated owner SELECT only; INSERT/UPDATE via service role
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. plans ─────────────────────────────────────────────────────────────────
-- Reference table: what each plan allows.
-- -1 in any _limit column means unlimited.

CREATE TABLE IF NOT EXISTS plans (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    text NOT NULL,
  slug                    text UNIQUE NOT NULL,
  monthly_price_rm        numeric(10, 2) NOT NULL DEFAULT 0,
  stripe_price_id         text,                          -- filled when Stripe is wired
  case_limit              integer NOT NULL DEFAULT 3,    -- -1 = unlimited
  evidence_pack_limit     integer NOT NULL DEFAULT 1,    -- -1 = unlimited
  team_member_limit       integer NOT NULL DEFAULT 1,
  payment_lock_enabled    boolean NOT NULL DEFAULT false,
  formal_demand_enabled   boolean NOT NULL DEFAULT false,
  lawyer_referral_enabled boolean NOT NULL DEFAULT false,
  reports_enabled         boolean NOT NULL DEFAULT false,
  created_at              timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE plans ENABLE ROW LEVEL SECURITY;

-- Anyone (including anonymous) can read plan definitions — needed for pricing page
CREATE POLICY "plans_public_read"
  ON plans FOR SELECT
  USING (true);

-- ─── 2. subscriptions ────────────────────────────────────────────────────────
-- One row per business. Updated only by the Stripe webhook (service role).

CREATE TABLE IF NOT EXISTS subscriptions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id            uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  stripe_customer_id     text,
  stripe_subscription_id text,
  stripe_price_id        text,
  plan_slug              text NOT NULL DEFAULT 'free' REFERENCES plans(slug),
  status                 text NOT NULL DEFAULT 'active',
  current_period_start   timestamptz,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean NOT NULL DEFAULT false,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subscriptions_business_unique UNIQUE (business_id)
);

CREATE INDEX IF NOT EXISTS subscriptions_business_id_idx ON subscriptions (business_id);
CREATE INDEX IF NOT EXISTS subscriptions_stripe_customer_idx ON subscriptions (stripe_customer_id);
CREATE INDEX IF NOT EXISTS subscriptions_stripe_sub_idx ON subscriptions (stripe_subscription_id);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- Owners can read their own subscription; no client-side writes
CREATE POLICY "subscriptions_owner_read"
  ON subscriptions FOR SELECT
  USING (
    business_id IN (
      SELECT id FROM businesses WHERE owner_id = auth.uid()
    )
  );

-- ─── 3. billing_events ───────────────────────────────────────────────────────
-- Append-only event log for Stripe webhook processing.
-- No client access — service role only.

CREATE TABLE IF NOT EXISTS billing_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     uuid REFERENCES businesses(id) ON DELETE SET NULL,
  stripe_event_id text UNIQUE NOT NULL,
  event_type      text NOT NULL,
  processed       boolean NOT NULL DEFAULT false,
  status          text NOT NULL DEFAULT 'pending',
  attempts        integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  event_created_at timestamptz,
  processed_at    timestamptz,
  last_error_code text,
  last_error_message text,
  metadata        jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE billing_events
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS event_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS processed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error_code text,
  ADD COLUMN IF NOT EXISTS last_error_message text;
ALTER TABLE billing_events DROP CONSTRAINT IF EXISTS billing_events_status_check;
ALTER TABLE billing_events ADD CONSTRAINT billing_events_status_check
  CHECK (status IN ('pending', 'processing', 'retry_scheduled', 'succeeded', 'dead_letter'));
ALTER TABLE billing_events DROP CONSTRAINT IF EXISTS billing_events_attempts_check;
ALTER TABLE billing_events ADD CONSTRAINT billing_events_attempts_check CHECK (attempts BETWEEN 0 AND 100);

CREATE INDEX IF NOT EXISTS billing_events_stripe_event_idx ON billing_events (stripe_event_id);
CREATE INDEX IF NOT EXISTS billing_events_business_idx     ON billing_events (business_id);
CREATE INDEX IF NOT EXISTS billing_events_processed_idx    ON billing_events (processed);
CREATE INDEX IF NOT EXISTS billing_events_retry_idx
  ON billing_events (next_attempt_at, created_at)
  WHERE status IN ('pending', 'retry_scheduled');

ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;
-- No SELECT / INSERT / UPDATE policies → only service_role key can access

-- ─── 4. entitlements ─────────────────────────────────────────────────────────
-- Denormalised snapshot of what a business is currently allowed to do.
-- Written by the webhook after subscription changes; read by the app.

CREATE TABLE IF NOT EXISTS entitlements (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id             uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  plan_slug               text NOT NULL DEFAULT 'free',
  case_limit              integer NOT NULL DEFAULT 3,    -- -1 = unlimited
  evidence_pack_limit     integer NOT NULL DEFAULT 1,    -- -1 = unlimited
  team_member_limit       integer NOT NULL DEFAULT 1,
  payment_lock_enabled    boolean NOT NULL DEFAULT false,
  formal_demand_enabled   boolean NOT NULL DEFAULT false,
  lawyer_referral_enabled boolean NOT NULL DEFAULT false,
  reports_enabled         boolean NOT NULL DEFAULT false,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT entitlements_business_unique UNIQUE (business_id)
);

CREATE INDEX IF NOT EXISTS entitlements_business_id_idx ON entitlements (business_id);

ALTER TABLE entitlements ENABLE ROW LEVEL SECURITY;

-- Owners can read their own entitlements; no client-side writes
CREATE POLICY "entitlements_owner_read"
  ON entitlements FOR SELECT
  USING (
    business_id IN (
      SELECT id FROM businesses WHERE owner_id = auth.uid()
    )
  );

-- ─── 5. Default plan data ────────────────────────────────────────────────────

INSERT INTO plans (name, slug, monthly_price_rm, case_limit, evidence_pack_limit, team_member_limit, payment_lock_enabled, formal_demand_enabled, lawyer_referral_enabled, reports_enabled)
VALUES
  ('Free',    'free',    0,   3,  1,  1, false, false, false, false),
  ('Starter', 'starter', 19,  20, 5,  1, true,  false, false, false),
  ('Boss',    'boss',    49,  -1, -1, 3, true,  true,  true,  true),
  ('Pro',     'pro',     99,  -1, -1, 10, true,  true,  true,  true)
ON CONFLICT (slug) DO UPDATE SET
  name                    = EXCLUDED.name,
  monthly_price_rm        = EXCLUDED.monthly_price_rm,
  case_limit              = EXCLUDED.case_limit,
  evidence_pack_limit     = EXCLUDED.evidence_pack_limit,
  team_member_limit       = EXCLUDED.team_member_limit,
  payment_lock_enabled    = EXCLUDED.payment_lock_enabled,
  formal_demand_enabled   = EXCLUDED.formal_demand_enabled,
  lawyer_referral_enabled = EXCLUDED.lawyer_referral_enabled,
  reports_enabled         = EXCLUDED.reports_enabled;

-- ─── 6. Auto-provision free tier on new business ─────────────────────────────
-- Trigger: when a new business is created, give it a free subscription + entitlements.

CREATE OR REPLACE FUNCTION provision_free_tier()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO subscriptions (business_id, plan_slug, status)
  VALUES (NEW.id, 'free', 'active')
  ON CONFLICT (business_id) DO NOTHING;

  INSERT INTO entitlements (
    business_id, plan_slug,
    case_limit, evidence_pack_limit, team_member_limit,
    payment_lock_enabled, formal_demand_enabled, lawyer_referral_enabled, reports_enabled
  )
  VALUES (
    NEW.id, 'free',
    3, 1, 1,
    false, false, false, false
  )
  ON CONFLICT (business_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_business_created_billing ON businesses;
CREATE TRIGGER on_business_created_billing
  AFTER INSERT ON businesses
  FOR EACH ROW
  EXECUTE FUNCTION provision_free_tier();

-- ─── 7. updated_at trigger for subscriptions ─────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS subscriptions_set_updated_at ON subscriptions;
CREATE TRIGGER subscriptions_set_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS entitlements_set_updated_at ON entitlements;
CREATE TRIGGER entitlements_set_updated_at
  BEFORE UPDATE ON entitlements
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

REVOKE ALL ON FUNCTION provision_free_tier() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION set_updated_at() FROM PUBLIC, anon, authenticated, service_role;
