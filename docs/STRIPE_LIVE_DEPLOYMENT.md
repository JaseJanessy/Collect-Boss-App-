# CollectBoss — Stripe Live Mode Deployment Guide

> **Audience:** Developer or operator switching CollectBoss from Stripe test mode to live mode.  
> **Prerequisite:** All steps in `STRIPE_LIVE_MODE_READY.md` are complete.  
> **Rule:** Never commit any key into source code. All keys go into Vercel Environment Variables only.

---

## A. Create Live Products in Stripe Dashboard

> Log in to [dashboard.stripe.com](https://dashboard.stripe.com) → toggle to **Live Mode** (top-left corner).

### Step A1 — Create the Starter product

1. Go to **Products** → **+ Add product**
2. Fill in:
   - **Name:** `CollectBoss Starter`
   - **Description:** `Up to 20 active cases, 5 evidence packs per case, Payment Lock feature`
3. Under **Pricing**, click **+ Add price**:
   - **Pricing model:** Standard pricing
   - **Billing period:** Monthly (recurring)
   - **Price:** `19.00`
   - **Currency:** `MYR`
4. Click **Save product**
5. Copy the **Price ID** (format: `price_live_...`) → this is your `STRIPE_PRICE_STARTER`

### Step A2 — Create the Boss product

1. Go to **Products** → **+ Add product**
2. Fill in:
   - **Name:** `CollectBoss Boss`
   - **Description:** `Unlimited cases, Formal Demand letters, Lawyer Referral, Reports, 3 team members`
3. Under **Pricing**, click **+ Add price**:
   - **Pricing model:** Standard pricing
   - **Billing period:** Monthly (recurring)
   - **Price:** `49.00`
   - **Currency:** `MYR`
4. Click **Save product**
5. Copy the **Price ID** → this is your `STRIPE_PRICE_BOSS`

### Step A3 — Create the Pro product

1. Go to **Products** → **+ Add product**
2. Fill in:
   - **Name:** `CollectBoss Pro`
   - **Description:** `Everything in Boss, 10 team members, priority support`
3. Under **Pricing**, click **+ Add price**:
   - **Pricing model:** Standard pricing
   - **Billing period:** Monthly (recurring)
   - **Price:** `99.00`
   - **Currency:** `MYR`
4. Click **Save product**
5. Copy the **Price ID** → this is your `STRIPE_PRICE_PRO`

### Price ID summary — fill in before proceeding

```
STRIPE_PRICE_STARTER = price_live_________________________________
STRIPE_PRICE_BOSS    = price_live_________________________________
STRIPE_PRICE_PRO     = price_live_________________________________
```

---

## B. Get Live API Keys

> In Stripe Dashboard (Live Mode) → **Developers** → **API keys**

### Step B1 — Copy the Publishable key

1. Click **Publishable key** → **Reveal live key**
2. Copy the key — starts with `pk_live_`
3. This is your `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`

### Step B2 — Copy the Secret key

1. Click **+ Create secret key** (or use the existing one)
2. Copy immediately — Stripe will not show it again
3. Starts with `sk_live_`
4. This is your `STRIPE_SECRET_KEY`

### Key rules

- ❌ Never paste keys into any source file
- ❌ Never put `sk_live_` in any `NEXT_PUBLIC_` variable
- ❌ Never commit `.env.local` if you add live keys to it (delete after Vercel setup)
- ✅ Add keys to Vercel **Production** environment only (see `VERCEL_PRODUCTION_ENV.md`)
- ✅ Keep `sk_test_` / `pk_test_` keys in Vercel **Preview** environment for staging

---

## C. Create the Live Webhook Endpoint

> In Stripe Dashboard (Live Mode) → **Developers** → **Webhooks** → **+ Add endpoint**

### Step C1 — Configure the endpoint

| Field | Value |
|---|---|
| Endpoint URL | `https://YOUR_PRODUCTION_DOMAIN/api/stripe/webhook` |
| Description | `CollectBoss production webhook` |

Replace `YOUR_PRODUCTION_DOMAIN` with your actual Vercel production domain, e.g.:
```
https://app.collectboss.my/api/stripe/webhook
```

### Step C2 — Select events

Click **Select events** and choose exactly these **6 events**:

| Event | Purpose |
|---|---|
| `checkout.session.completed` | Activates subscription after checkout |
| `customer.subscription.created` | Records new subscription to database |
| `customer.subscription.updated` | Handles renewals, plan changes, pause/resume |
| `customer.subscription.deleted` | Reverts plan to Free when sub ends |
| `invoice.payment_succeeded` | Confirms renewal — keeps plan active |
| `invoice.payment_failed` | Marks plan `past_due` — triggers in-app alert |

Click **Add endpoint**.

### Step C3 — Copy the Signing secret

1. After creating the endpoint, click on it in the webhook list
2. Click **Reveal signing secret**
3. Copy the value — starts with `whsec_`
4. This is your `STRIPE_WEBHOOK_SECRET`

> ⚠️ Test mode and live mode have different webhook endpoints and different signing secrets. Do not mix them.

---

## D. Activate the Customer Portal (Live Mode)

> Stripe Dashboard (Live Mode) → **Settings** → **Billing** → **Customer portal**

1. Toggle the portal to **Active**
2. Set **Return URL** to: `https://YOUR_PRODUCTION_DOMAIN/billing`
3. Under **Customer portal features**, enable:
   - ✅ Update payment method
   - ✅ View invoice history
   - ✅ Cancel subscription
4. Click **Save**

---

## E. Set Environment Variables in Vercel

Open your Vercel project → **Settings** → **Environment Variables**.

Add each variable below. For the **Environment** column, select **Production** only (not Preview or Development) unless noted.

| Variable | Environment | Value |
|---|---|---|
| `STRIPE_SECRET_KEY` | Production | `sk_live_...` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Production | `pk_live_...` |
| `STRIPE_WEBHOOK_SECRET` | Production | `whsec_...` (live) |
| `STRIPE_PRICE_STARTER` | Production | `price_live_...` |
| `STRIPE_PRICE_BOSS` | Production | `price_live_...` |
| `STRIPE_PRICE_PRO` | Production | `price_live_...` |
| `NEXT_PUBLIC_APP_ENV` | Production | `production` |
| `NEXT_PUBLIC_APP_URL` | Production | `https://YOUR_PRODUCTION_DOMAIN` |

> Also add the Supabase variables to Production if not already set — see `VERCEL_PRODUCTION_ENV.md`.

---

## F. Trigger Production Deployment

After all env vars are saved in Vercel:

```bash
git push origin main
```

Or in Vercel Dashboard → **Deployments** → click **Redeploy** on the latest deployment with updated env vars.

Wait for the build to succeed (builds take ~2 minutes). Confirm the deployment is live before proceeding.

---

## G. Verify Live Mode Is Working

After deployment, run through these checks:

1. **Test Mode badge** — Open the production URL. No amber "TEST MODE" or "STAGING" badge should appear anywhere in the sidebar or mobile header.

2. **Billing page loads** — Visit `/billing`. Plan cards should render without error.

3. **Webhook delivery** — Make a test purchase (Step H). After purchase, check:
   - Stripe Dashboard (Live Mode) → Webhooks → your endpoint → shows recent 200 responses
   - No failed events in the webhook log

4. **Subscription activates** — Check Supabase production DB:
   - `subscriptions` table: a row exists with `status = active`
   - `entitlements` table: reflects the correct plan limits

5. **Customer Portal opens** — From `/billing`, click "Manage Subscription" → redirects to Stripe Customer Portal.

---

## H. First Real Payment Test

> ⚠️ This charges a real card. Use your own card and refund immediately after.

1. Create a fresh account on the production URL
2. Complete business profile onboarding
3. Go to `/billing` → Subscribe to **Starter** (RM 19/month)
4. Enter your real card details and complete checkout
5. Confirm redirect to `/billing/success`
6. Return to `/billing` — plan should show "Starter" within 60 seconds
7. Open Customer Portal → cancel the subscription
8. Go to Stripe Dashboard → **Payments** → find the RM 19 charge → click **Refund**

---

## I. Post-Launch Monitoring

- **Stripe Dashboard → Webhooks → your endpoint** — Monitor for failed deliveries in the first 24 hours
- **Supabase → billing_events table** — All rows should have `processed = true`
- **Stripe Dashboard → Billing → Subscriptions** — Monitor `past_due` subscriptions
- Set up Stripe email notifications: Dashboard → Settings → Email → Webhooks
