# CollectBoss — Stripe Test Mode Setup Guide

This guide walks you through setting up Stripe in test mode for local development and staging.

**⚠️ Never use live Stripe keys until all QA tests in `docs/BILLING_QA.md` pass.**

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | ≥ 18 | https://nodejs.org |
| Stripe CLI | Latest | `brew install stripe/stripe-cli/stripe` |
| Supabase CLI | Latest | `npm i -g supabase` |

---

## Step 1 — Get Stripe Test API Keys

1. Go to [Stripe Dashboard](https://dashboard.stripe.com) → Make sure **Test mode** is ON (toggle top-right)
2. Go to **Developers → API keys**
3. Copy:
   - `Publishable key` (`pk_test_...`)
   - `Secret key` (`sk_test_...`) → click "Reveal"

Add to `.env.local`:
```bash
STRIPE_SECRET_KEY=sk_test_YOUR_KEY_HERE
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_YOUR_KEY_HERE
```

---

## Step 2 — Create Stripe Products and Prices

In Stripe Dashboard → **Catalog → Products → Add product**:

### Starter Plan
- **Name:** CollectBoss Starter
- **Pricing model:** Standard pricing → Recurring
- **Price:** MYR 19.00 / month
- Save → copy the Price ID (`price_...`)

### Boss Plan
- **Name:** CollectBoss Boss
- **Price:** MYR 49.00 / month
- Save → copy Price ID

### Pro Plan
- **Name:** CollectBoss Pro
- **Price:** MYR 99.00 / month
- Save → copy Price ID

Add to `.env.local`:
```bash
STRIPE_PRICE_STARTER=price_STARTER_ID_HERE
STRIPE_PRICE_BOSS=price_BOSS_ID_HERE
STRIPE_PRICE_PRO=price_PRO_ID_HERE
```

---

## Step 3 — Set App URL

```bash
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

For staging/Vercel preview:
```bash
NEXT_PUBLIC_APP_URL=https://your-preview-url.vercel.app
```

---

## Step 4 — Run Supabase Billing Migration

```bash
# Option A: Use Supabase local
supabase db reset

# Option B: Run manually in Supabase Dashboard → SQL Editor
# Paste contents of supabase/billing.sql
```

Verify tables exist:
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN ('plans', 'subscriptions', 'billing_events', 'entitlements');
```

---

## Step 5 — Start the Dev Server

```bash
npm run dev
```

Open [http://localhost:3000/dev/billing-debug](http://localhost:3000/dev/billing-debug) to verify:
- ✅ Stripe configured
- ✅ Supabase configured
- All price IDs present

---

## Step 6 — Start Stripe CLI Webhook Forwarding

In a separate terminal:

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

You will see:
```
> Ready! Your webhook signing secret is whsec_... (^C to quit)
```

Copy `whsec_...` → add to `.env.local`:
```bash
STRIPE_WEBHOOK_SECRET=whsec_YOUR_SECRET_HERE
```

**Restart `npm run dev` after adding the webhook secret.**

---

## Step 7 — Enable Stripe Customer Portal

In Stripe Dashboard → **Settings → Billing → Customer portal**:

1. Enable the portal
2. Enable these features:
   - ✅ Update payment methods
   - ✅ Cancel subscriptions
   - ✅ View invoice history
   - ✅ Update billing information
3. Set **Return URL:** `http://localhost:3000/billing`
4. Click **Save** then **Activate test link**

---

## Step 8 — Enable Webhook Events in Dashboard

> **For local dev:** Stripe CLI handles this automatically.
> **For staging/production:** Register the endpoint in Stripe Dashboard.

**Webhook URL:** `https://your-app.vercel.app/api/stripe/webhook`

**Events to enable:**

| Event | Why |
|-------|-----|
| `checkout.session.completed` | Subscription created after checkout |
| `customer.subscription.created` | Subscription object created |
| `customer.subscription.updated` | Plan change, renewal, pause |
| `customer.subscription.deleted` | Cancellation → revert to Free |
| `invoice.payment_succeeded` | Renewal OK → keep entitlements |
| `invoice.payment_failed` | Payment failure → downgrade to Free |

---

## Test Card Numbers

| Card Number | Scenario |
|-------------|----------|
| `4242 4242 4242 4242` | Successful payment |
| `4000 0000 0000 3220` | 3D Secure (requires authentication) |
| `4000 0000 0000 9995` | Insufficient funds |
| `4000 0000 0000 0341` | Payment always fails (for `invoice.payment_failed`) |
| `5200 8282 8282 8210` | Mastercard — successful |

**Expiry:** Any future date (e.g., `12/34`)  
**CVC:** Any 3 digits (e.g., `123`)  
**Postcode:** Any (e.g., `50000`)

---

## How to Test: Successful Checkout

1. Log in to CollectBoss as a test user
2. Go to `/billing`
3. Click **Subscribe** on the Starter card
4. At Stripe Checkout, use card `4242 4242 4242 4242`
5. Complete checkout
6. You land on `/billing/success`
7. Wait ~2 seconds for webhook to fire
8. Go to `/billing` — plan badge should show "Starter"
9. Check DB:
   ```sql
   SELECT plan_slug, status FROM subscriptions WHERE business_id = 'your-biz-id';
   SELECT plan_slug, case_limit FROM entitlements WHERE business_id = 'your-biz-id';
   ```

---

## How to Test: Failed Payment

1. Subscribe to a paid plan (successful checkout first)
2. Trigger failed invoice:
   ```bash
   stripe trigger invoice.payment_failed
   ```
3. Check Billing page — should show "Past Due" red banner
4. Check DB: `subscriptions.status = 'past_due'`, `entitlements.plan_slug = 'free'`
5. Try accessing `/reports` — should show upgrade gate again

---

## How to Test: Cancel Subscription

1. On Billing page (paid plan), click **Manage Subscription**
2. In Stripe Portal, click **Cancel plan**
3. Choose "Cancel at end of billing period"
4. Return to `/billing`
5. Billing page should show amber "Cancels on [date]" warning
6. Check DB: `subscriptions.cancel_at_period_end = true`

To simulate the period ending (immediate cancellation):
```bash
stripe trigger customer.subscription.deleted
```

---

## How to Test: Duplicate Webhook Events

1. Find a processed event ID in the `billing_events` table
2. In Stripe Dashboard → **Developers → Events** → find the event → **Resend**
3. Check the webhook log — should see `200 OK`
4. Check DB — no duplicate row in `billing_events`
5. `subscriptions` and `entitlements` not changed again

---

## Verifying the Database

Useful queries to run in Supabase SQL Editor:

```sql
-- Check latest subscription
SELECT * FROM subscriptions ORDER BY updated_at DESC LIMIT 5;

-- Check entitlements
SELECT * FROM entitlements ORDER BY updated_at DESC LIMIT 5;

-- Check billing events (most recent first)
SELECT stripe_event_id, event_type, processed, created_at
FROM billing_events
ORDER BY created_at DESC
LIMIT 20;

-- Check plans seed data
SELECT * FROM plans ORDER BY monthly_price_rm;
```

---

## Common Issues and Fixes

| Issue | Fix |
|-------|-----|
| `STRIPE_WEBHOOK_SECRET is not set` | Copy `whsec_...` from Stripe CLI output to `.env.local`, restart dev server |
| Portal returns "No active billing account found" | User has no `stripe_customer_id` in `subscriptions` — subscribe to a paid plan first |
| Webhook returns 400 "Signature invalid" | Wrong webhook secret, or request body was modified before reaching the route handler |
| Entitlements not updating | Webhook not receiving events — check `stripe listen` is running |
| `billing_events` shows `processed = false` | An error occurred during webhook processing — check server logs |
| Free plan shows case_limit = null | `supabase/billing.sql` migration not run — run it in SQL Editor |
| Cannot access Stripe Customer Portal | Portal not activated in Stripe Dashboard → Settings → Billing |

---

## Going Live Checklist

Before switching to live mode:

- [ ] All QA tests in `docs/BILLING_QA.md` pass
- [ ] Replace test keys with live keys in Vercel env vars
- [ ] Create live Stripe products (separate from test products)
- [ ] Register live webhook endpoint in Stripe Dashboard
- [ ] Enable Customer Portal in live mode
- [ ] Set `NEXT_PUBLIC_APP_URL` to production URL
- [ ] Run `supabase/billing.sql` on production Supabase
- [ ] Verify `NEXT_PUBLIC_APP_ENV=production` blocks `/dev/billing-debug`
- [ ] Test one live payment with a real card (then refund)
