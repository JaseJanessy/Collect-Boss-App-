# CollectBoss — Stripe Live Mode Readiness Checklist

> **Purpose:** Work through this document before switching Stripe from test mode to live mode.  
> Complete every section in order. Do NOT switch to live mode until all ✅ items are confirmed.

---

## 1. Test Mode Checklist (Complete Before Going Live)

These must all pass in test mode before switching:

### Stripe Checkout flow
- [ ] User can click "Subscribe" on the Billing page → redirected to Stripe Checkout
- [ ] Test card `4242 4242 4242 4242` (any future expiry, any CVC) completes payment
- [ ] After payment, user is redirected to `/billing/success`
- [ ] `/billing/success` shows "Payment received" message
- [ ] Supabase `subscriptions` table updates within 60 seconds of checkout
- [ ] Supabase `entitlements` table updates to match the new plan
- [ ] Plan badge in the app updates (may require a page refresh)

### Webhook delivery
- [ ] Stripe Dashboard → Webhooks → your endpoint shows recent successful deliveries (200 responses)
- [ ] `checkout.session.completed` event arrives and is processed
- [ ] `customer.subscription.created` event arrives and is processed
- [ ] `invoice.payment_succeeded` event arrives and is processed
- [ ] All events appear in Supabase `billing_events` table with `processed = true`

### Failed payment flow
- [ ] Test card `4000 0000 0000 0341` triggers a failed payment
- [ ] `invoice.payment_failed` webhook is received
- [ ] Supabase subscription status updates to `past_due`
- [ ] In-app alert shows "Payment failed" or "Past Due" banner on `/billing`

### Cancellation flow
- [ ] User opens Stripe Customer Portal via "Manage Subscription" button
- [ ] User can cancel their subscription
- [ ] `customer.subscription.deleted` webhook is received after period end
- [ ] Supabase `entitlements` reverts to free plan limits

### Customer Portal
- [ ] Stripe Customer Portal is activated in Stripe Dashboard → Settings → Billing → Customer portal
- [ ] Portal return URL is set to `{NEXT_PUBLIC_APP_URL}/billing`
- [ ] Users can update payment method in the portal
- [ ] Users can view invoice history in the portal

---

## 2. Stripe Products Required for Live Mode

Create these three products in Stripe Live mode Dashboard (Dashboard → Products → Add product).

> ⚠️ Live mode and test mode have separate product/price databases. You must recreate them in live mode.

### Starter — RM 19/month

| Field | Value |
|---|---|
| Product name | CollectBoss Starter |
| Description | Up to 20 cases, 5 evidence packs/case, Payment Lock |
| Price | RM 19.00 |
| Billing period | Monthly (recurring) |
| Currency | MYR |
| Env var to update | `STRIPE_PRICE_STARTER` |

### Boss — RM 49/month

| Field | Value |
|---|---|
| Product name | CollectBoss Boss |
| Description | Unlimited cases, Formal Demand, Lawyer Referral, Reports, 3 team members |
| Price | RM 49.00 |
| Billing period | Monthly (recurring) |
| Currency | MYR |
| Env var to update | `STRIPE_PRICE_BOSS` |

### Pro — RM 99/month

| Field | Value |
|---|---|
| Product name | CollectBoss Pro |
| Description | Everything in Boss, 10 team members, priority support |
| Price | RM 99.00 |
| Billing period | Monthly (recurring) |
| Currency | MYR |
| Env var to update | `STRIPE_PRICE_PRO` |

After creating products:
1. Copy each live price ID (format: `price_live_...`)
2. Set them in Vercel → Environment Variables → Production only:
   - `STRIPE_PRICE_STARTER=price_live_...`
   - `STRIPE_PRICE_BOSS=price_live_...`
   - `STRIPE_PRICE_PRO=price_live_...`

---

## 3. Webhook Endpoint Configuration

### For live mode, create a new webhook endpoint in Stripe Dashboard

**Stripe Dashboard → Developers → Webhooks → Add endpoint**

| Field | Value |
|---|---|
| Endpoint URL | `https://app.collectboss.my/api/stripe/webhook` |
| Description | CollectBoss production webhook |
| API version | Latest (automatically set) |

### Required webhook events

Select exactly these 6 events — no more, no less:

| Event | Why it&apos;s required |
|---|---|
| `checkout.session.completed` | Activates subscription after successful checkout |
| `customer.subscription.created` | Records new subscription in DB |
| `customer.subscription.updated` | Handles plan changes, renewals, pause/resume |
| `customer.subscription.deleted` | Reverts plan to Free when subscription ends |
| `invoice.payment_succeeded` | Confirms renewal payment — keeps plan active |
| `invoice.payment_failed` | Marks plan as `past_due` — triggers in-app alert |

### After creating the webhook

1. Click the webhook endpoint in Stripe Dashboard
2. Click **Reveal signing secret** → copy the `whsec_...` value
3. Set it in Vercel → Environment Variables → Production:  
   `STRIPE_WEBHOOK_SECRET=whsec_live_...`
4. **Do NOT reuse the test mode webhook secret** — test and live mode have separate secrets

---

## 4. Going Live — Step-by-Step

Follow this sequence exactly. Do not skip steps.

### Step 1 — Activate Stripe live mode

1. Log in to [dashboard.stripe.com](https://dashboard.stripe.com)
2. Toggle from **Test mode** to **Live mode** (top-left toggle)
3. Complete Stripe business verification if not already done:
   - Company name, registration number, address, director details
   - Bank account for payouts (DuitNow or Malaysian bank account)
   - Identity verification

### Step 2 — Get live API keys

1. Stripe Dashboard (live mode) → Developers → API keys
2. Copy **Publishable key** (`pk_live_...`)
3. Copy **Secret key** (`sk_live_...`) — save this securely, it will not be shown again

### Step 3 — Create live products

Follow Section 2 above to create all three products and prices in live mode.

### Step 4 — Create live webhook endpoint

Follow Section 3 above to create the webhook and get the live signing secret.

### Step 5 — Update Vercel environment variables

In Vercel → Settings → Environment Variables, update **Production** environment only:

```
STRIPE_SECRET_KEY=sk_live_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_live_...
STRIPE_PRICE_STARTER=price_live_...
STRIPE_PRICE_BOSS=price_live_...
STRIPE_PRICE_PRO=price_live_...
NEXT_PUBLIC_APP_ENV=production
NEXT_PUBLIC_APP_URL=https://app.collectboss.my
```

Keep test mode keys in **Preview** environment for staging/testing.

### Step 6 — Redeploy production

After updating all env vars, trigger a new Vercel deployment:
```bash
git push origin main
```

Or use Vercel Dashboard → Deployments → Redeploy.

### Step 7 — Activate Customer Portal (live mode)

1. Stripe Dashboard (live mode) → Settings → Billing → Customer portal
2. Enable the portal
3. Set **Return URL** to `https://app.collectboss.my/billing`
4. Configure allowed actions:
   - ✅ Update payment method
   - ✅ View invoice history
   - ✅ Cancel subscription
   - ✅ Change subscription (optional)

### Step 8 — Verify end-to-end in live mode

> ⚠️ This will charge a real card. Use a card you control for testing.

1. Create a test account on the live app
2. Go to `/billing` → Subscribe to Starter (RM 19)
3. Use your real card — you will be charged RM 19
4. Confirm the plan updates in the app within 60 seconds
5. Check Stripe Dashboard (live mode) → Events — webhook should show 200 responses
6. Check Supabase production DB — `subscriptions` and `entitlements` should be updated
7. Cancel via Customer Portal — confirm the subscription remains active until period end
8. Refund the RM 19 via Stripe Dashboard → Payments → Refund

---

## 5. Stripe Live Mode Safety Notes

- **Never expose `sk_live_`** anywhere in client-side code. Verified safe ✅
- **Never set `STRIPE_SECRET_KEY` as `NEXT_PUBLIC_STRIPE_SECRET_KEY`** — this would expose it
- **Test webhook signatures** after going live — use Stripe Dashboard → Webhooks → Send test event
- **Monitor failed payments** via Stripe Dashboard → Billing → Subscriptions → filter by `past_due`
- **Set up email receipts** in Stripe Dashboard → Settings → Email → Customer emails → Receipts

---

## 6. Rollback Plan

If something goes wrong after going live:

1. In Vercel → Settings → Environment Variables, revert `STRIPE_SECRET_KEY` to `sk_test_...`
2. Revert `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` to `pk_test_...`
3. Revert `STRIPE_PRICE_*` to test mode price IDs
4. Revert `STRIPE_WEBHOOK_SECRET` to test mode `whsec_test_...`
5. Redeploy Vercel
6. Any subscriptions created in live mode will remain in Stripe — refund manually via Stripe Dashboard

---

## 7. Pre-Launch Final Checklist

- [ ] Stripe business verification complete (required for live payments)
- [ ] Malaysian bank account connected to Stripe for payouts
- [ ] Three live products created (Starter RM19, Boss RM49, Pro RM99)
- [ ] Live webhook endpoint created with all 6 events
- [ ] Live API keys set in Vercel production environment
- [ ] Live price IDs set in Vercel production environment
- [ ] `NEXT_PUBLIC_APP_ENV=production` set in Vercel production
- [ ] `NEXT_PUBLIC_APP_URL` points to production domain
- [ ] Customer Portal activated in live mode with correct return URL
- [ ] End-to-end payment tested and confirmed (Section 8)
- [ ] Test Mode badge no longer shows in production app
- [ ] `/dev/billing-debug` route blocked in production (returns 404)
- [ ] Supabase production project is running (not the development project)
- [ ] Supabase RLS is enabled on all tables
- [ ] Storage buckets (`evidence-files`, `payment-proofs`) are private
