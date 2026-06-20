# CollectBoss — Production Billing Smoke Test Plan

> **When to run:** Immediately after deploying to Vercel production with live Stripe keys.  
> **Who runs it:** Developer or operator — use your own real card.  
> **Duration:** ~20 minutes.  
> **Cost:** RM 19 (refunded in the final step).

---

## Prerequisites

Before starting:
- [ ] Vercel production deployment is live and accessible
- [ ] All 11 environment variables are set in Vercel Production
- [ ] Stripe is in Live Mode (`sk_live_` keys)
- [ ] Stripe live webhook endpoint is registered and pointing to production URL
- [ ] Supabase production project is configured (schema applied, RLS on, buckets private)
- [ ] You have a real Visa/Mastercard/Amex card for testing

Open two browser windows:
- **Window A:** Your CollectBoss production URL
- **Window B:** [dashboard.stripe.com](https://dashboard.stripe.com) → Live Mode → Webhooks → your endpoint

---

## Test 1 — Register New Account

1. In Window A: go to `/signup`
2. Register a **new** email address (use a dedicated test email, not your personal one)
3. Check your email for OTP or magic link
4. Complete email verification
5. **Expected:** Redirected to `/onboarding/profile`
6. **Check:** No error messages. Auth flow completes cleanly.

---

## Test 2 — Create Business Profile

1. Fill in the onboarding form:
   - Business name: `Smoke Test Business`
   - Any valid address
   - Payment Lock: choose any mode
2. Click **Save**
3. **Expected:** Redirected to Dashboard
4. **Check:** Dashboard loads. No errors.

---

## Test 3 — Confirm Free Plan Entitlement

1. Go to `/billing`
2. **Expected:** 
   - Current plan shows **Free**
   - Plan card for Starter, Boss, Pro all show "Subscribe" button
   - No "TEST MODE" or "STAGING" badge anywhere in the UI
3. Go to `/add`
4. **Expected:** Case creation form loads (Free plan allows up to 3 cases)
5. **Check:** No entitlement errors on page load.

---

## Test 4 — Stripe Checkout (Real Payment)

> ⚠️ This will charge RM 19 to your real card.

1. Go to `/billing`
2. Click **Subscribe** on the **Starter** plan (RM 19/month)
3. **Expected:** Redirected to Stripe Checkout (Stripe-hosted page, not CollectBoss)
4. On Stripe Checkout:
   - Enter your real card details
   - Billing address: Malaysia
   - Email: your test email
5. Click **Subscribe** / **Pay**
6. **Expected:** Redirected to `/billing/success`
7. **Verify success page:**
   - Shows "Payment received" message
   - Shows "Go to Dashboard" button
   - No error or blank page

---

## Test 5 — Confirm Stripe Webhook Received

1. In Window B (Stripe Dashboard → Webhooks → your endpoint):
   - Click on your production webhook endpoint
   - Look at **Recent events** tab
2. **Expected within 30 seconds of checkout:**
   - `checkout.session.completed` — status: **200**
   - `customer.subscription.created` — status: **200**
   - `invoice.payment_succeeded` — status: **200**
3. **If any event shows a non-200 response:**
   - Click the event → click **Retry**
   - Check Vercel function logs for errors
   - Common issue: wrong `STRIPE_WEBHOOK_SECRET` in Vercel env

---

## Test 6 — Confirm Subscription Status in Supabase

> Access: Supabase Dashboard → your production project → Table Editor

1. Open `subscriptions` table
2. **Expected:** A row exists with:
   - `business_id` matching your test business
   - `status = active`
   - `plan_slug = starter`
   - `stripe_customer_id` populated (starts with `cus_`)
   - `stripe_subscription_id` populated (starts with `sub_`)

3. Open `entitlements` table
4. **Expected:** A row exists with:
   - `case_limit = 20`
   - `evidence_pack_limit = 5`
   - `payment_lock_enabled = true`
   - `formal_demand_enabled = false`

5. Open `billing_events` table
6. **Expected:** 3 rows (one per webhook event), all with `processed = true`

---

## Test 7 — Confirm In-App Plan Update

1. Return to Window A → go to `/billing`
2. **Expected within 60 seconds of checkout:**
   - Current plan banner shows **Starter**
   - Status pill shows **Active**
   - "Manage Subscription" button is visible
   - Plan card for Starter shows no "Subscribe" button
3. If plan still shows Free after 60 seconds:
   - Hard refresh the page (Ctrl+Shift+R)
   - If still Free: check webhook delivery in Stripe Dashboard

---

## Test 8 — Confirm Entitlement Unlocked

1. Go to `/add` and try to create a case
2. **Expected:** No entitlement error. Form renders normally.
3. Go to the case → Documents → try to access Formal Demand
4. **Expected:** Feature is still locked (Starter does not include Formal Demand — correct behaviour)
5. Verify Payment Lock setting is accessible (Starter includes Payment Lock)

---

## Test 9 — Open Customer Portal

1. Go to `/billing`
2. Click **Manage Subscription**
3. **Expected:** Redirected to Stripe Customer Portal (Stripe-hosted)
4. **Verify in portal:**
   - Current plan shows Starter RM 19/month
   - Payment method card is visible
   - Invoice history shows the RM 19 charge
   - Cancel subscription option is available

---

## Test 10 — Cancel Subscription (via Portal)

1. In the Customer Portal, click **Cancel plan**
2. Choose **Cancel at end of period** (NOT immediate cancel)
3. Confirm cancellation
4. Return to CollectBoss (portal redirects to `/billing`)
5. **Expected in Stripe Dashboard:** `customer.subscription.updated` event with `cancel_at_period_end = true`
6. **Expected in Supabase `subscriptions` table:** `cancel_at_period_end = true`
7. **Expected in app:** `/billing` shows a yellow "Cancellation scheduled" warning banner

---

## Test 11 — Security: Manual Entitlement Change Attempt

> Verify users cannot elevate their own plan by direct DB manipulation.

1. Open browser DevTools → Application → Supabase session cookie
2. Try a direct Supabase API call to update the `entitlements` table:
   ```
   PATCH /rest/v1/entitlements?business_id=eq.YOUR_BUSINESS_ID
   Body: { "case_limit": -1, "formal_demand_enabled": true }
   ```
3. Use the anon key (not service role)
4. **Expected:** Request returns `403 Forbidden` or `0 rows affected`
5. **Reason:** RLS policy on `entitlements` table allows only SELECT for authenticated users — no INSERT, UPDATE, or DELETE

---

## Test 12 — Refund Test Charge

1. Go to Stripe Dashboard (Live Mode) → **Payments**
2. Find the RM 19 charge from the test
3. Click **Refund** → Full refund → Confirm
4. **Expected:** Refund issued. RM 19 returned to card within 5-10 business days.

---

## Pass / Fail Criteria

| Test | Pass condition |
|---|---|
| 1 — Register | Email verification works, redirects to onboarding |
| 2 — Onboarding | Profile saved, redirects to dashboard |
| 3 — Free plan | Shows Free, no test badge in production |
| 4 — Checkout | Stripe Checkout loads, payment completes, success page shown |
| 5 — Webhook | All 3 events show 200 in Stripe Dashboard within 60 seconds |
| 6 — Supabase | `subscriptions.status = active`, `entitlements` correct |
| 7 — In-app plan | Plan badge updates to Starter within 60 seconds |
| 8 — Entitlement | Correct features unlocked for Starter |
| 9 — Portal | Customer Portal opens and shows correct plan |
| 10 — Cancel | `cancel_at_period_end = true` in DB and shown in UI |
| 11 — Security | Manual entitlement update rejected by RLS |
| 12 — Refund | RM 19 refunded successfully |

**All 12 tests must pass before declaring CollectBoss production-ready for billing.**

---

## Troubleshooting

### Webhook events not appearing
- Check: `STRIPE_WEBHOOK_SECRET` in Vercel Production env matches the live endpoint's signing secret
- Check: The webhook endpoint URL matches exactly: `https://YOUR_DOMAIN/api/stripe/webhook`
- Check: Vercel function logs (Vercel → Deployments → Functions → `/api/stripe/webhook`)

### Plan not updating after checkout
- Wait 60–90 seconds — webhook processing can be delayed
- Check Stripe Dashboard → Webhooks → Recent events — look for failed deliveries
- Check Supabase `billing_events` — look for rows with `processed = false`

### Customer Portal not opening
- Verify Customer Portal is activated in Stripe Dashboard (Live Mode) → Settings → Billing → Customer portal
- Verify `NEXT_PUBLIC_APP_URL` is set correctly in Vercel Production
- Check `create-customer-portal-session` function logs

### RLS test (Test 11) passes unexpectedly
- Confirm the `entitlements` table in Supabase has RLS enabled
- Go to Supabase → Table Editor → `entitlements` → Policies → verify UPDATE policy does not exist for authenticated users
