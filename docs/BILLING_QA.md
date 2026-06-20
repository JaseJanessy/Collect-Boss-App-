# CollectBoss — Stripe Billing QA Checklist

**Version:** Step 28 (Stripe Customer Portal)
**Test environment:** Staging / local dev with Stripe Test Mode
**Stripe mode:** Test only — never run with live keys until all tests pass

---

## How to use this checklist

Mark each test:
- ✅ Pass
- ❌ Fail — note the failure details and screenshot
- ⚠️ Partial — works but has minor issues
- ⏭ Skipped

Priority: 🔴 Critical | 🟡 High | 🟢 Medium

---

## Required before testing

- [ ] Stripe CLI installed: `brew install stripe/stripe-cli/stripe`
- [ ] Logged into Stripe CLI: `stripe login`
- [ ] Webhook forwarding running: `stripe listen --forward-to localhost:3000/api/stripe/webhook`
- [ ] Copy the `whsec_...` secret from Stripe CLI output → `STRIPE_WEBHOOK_SECRET` in `.env.local`
- [ ] Three Stripe test prices created and IDs in `.env.local`
- [ ] Supabase running with `supabase/billing.sql` migration applied
- [ ] Visit `/dev/billing-debug` to verify env status

---

## SECTION 1 — Free Plan Defaults 🔴

### BQ-001 — New business starts on Free plan 🔴
**Steps:** Create new account → complete onboarding profile
**Expected:**
- `subscriptions` table has `plan_slug = 'free'`, `status = 'active'`
- `entitlements` table has `case_limit = 3`, `evidence_pack_limit = 1`
- Billing page shows "Free" plan badge
- Dashboard usage meters show "0 / 3" for cases

| Result | Notes |
|--------|-------|
| | |

---

### BQ-002 — Free plan shows correct limits 🔴
**Steps:** Open Billing page on a new Free account
**Expected:**
- Plan badge shows "Free"
- No `SubscriptionManagementCard` (only shown for paid plans)
- Plan cards show correct feature grids

| Result | Notes |
|--------|-------|
| | |

---

### BQ-003 — Free plan allows up to 3 cases 🟡
**Steps:** Create 3 cases on a Free account
**Expected:**
- All 3 cases created successfully
- Dashboard usage meter shows "3 / 3"
- No upgrade prompt shown

| Result | Notes |
|--------|-------|
| | |

---

### BQ-004 — 4th case blocked with upgrade prompt 🔴
**Steps:** Try to create a 4th case on a Free account
**Expected:**
- `/add` page shows `UpgradePrompt` instead of the form
- Reason text: "Your current plan allows 3 active cases. You have reached your plan limit."
- "View Plans" button navigates to `/billing`
- `POST /api/billing/validate-action` with `action: "create_case"` returns `{ allowed: false }`

| Result | Notes |
|--------|-------|
| | |

---

### BQ-005 — Payment Lock locked on Free 🔴
**Steps:** Try to add a case and reach Step 2 (payment lock) on Free account
**Expected:**
- "Require Approval" option is disabled
- Shows "Upgrade to unlock" amber badge
- "Show Immediately" and "Manual" options remain selectable

| Result | Notes |
|--------|-------|
| | |

---

### BQ-006 — Formal Demand locked on Free 🔴
**Steps:** Navigate to `/legal/[caseId]/demand`
**Expected:**
- `LockedFeature` card shown, not the demand form
- "Boss plan required" shown
- "View Plans" button navigates to `/billing`

| Result | Notes |
|--------|-------|
| | |

---

### BQ-007 — Lawyer Referral locked on Free 🔴
**Steps:** Navigate to `/legal/[caseId]/lawyer`
**Expected:**
- `LockedFeature` card shown
- "Boss plan required"

| Result | Notes |
|--------|-------|
| | |

---

### BQ-008 — Reports locked on Free 🔴
**Steps:** Navigate to `/reports`
**Expected:**
- `UpgradePrompt` (page variant) shown, not the reports dashboard
- "Boss plan required"

| Result | Notes |
|--------|-------|
| | |

---

## SECTION 2 — Stripe Checkout 🔴

### BQ-009 — Checkout redirects for Starter 🔴
**Steps:** On Billing page, click "Subscribe" on Starter card
**Expected:**
- Button shows loading spinner "Redirecting…"
- Browser redirects to `checkout.stripe.com`
- Checkout shows "Starter" product and RM 19/month

| Result | Notes |
|--------|-------|
| | |

---

### BQ-010 — Checkout redirects for Boss 🔴
**Steps:** Click "Subscribe" on Boss card
**Expected:**
- Redirects to Stripe Checkout with Boss RM 49/month

| Result | Notes |
|--------|-------|
| | |

---

### BQ-011 — Checkout redirects for Pro 🟡
**Steps:** Click "Subscribe" on Pro card
**Expected:**
- Redirects to Stripe Checkout with Pro RM 99/month

| Result | Notes |
|--------|-------|
| | |

---

### BQ-012 — Cancel page works 🟡
**Steps:** Start checkout → click "Back" in Stripe Checkout
**Expected:**
- Redirects to `/billing/cancel`
- Shows "Checkout cancelled. No payment was made."
- "Back to Billing" and "Go to Dashboard" buttons work
- No subscription created

| Result | Notes |
|--------|-------|
| | |

---

### BQ-013 — Success page works 🔴
**Steps:** Complete test checkout with card `4242 4242 4242 4242`
**Expected:**
- Redirects to `/billing/success?session_id=cs_test_...`
- Shows "Payment received!"
- Shows activation-in-progress message
- No plan change happens on this page itself

| Result | Notes |
|--------|-------|
| | |

---

### BQ-014 — Frontend success page does NOT change subscription 🔴
**Steps:** Inspect DB immediately after reaching `/billing/success`
**Expected:**
- `subscriptions.plan_slug` is still `free` until webhook fires
- `entitlements` unchanged until webhook fires
- Plan update happens ONLY after webhook processes

| Result | Notes |
|--------|-------|
| | |

---

### BQ-015 — Checkout price validated server-side 🔴
**Steps:** Use `curl` or Postman to call `POST /api/billing/create-checkout-session` with `{ "plan_slug": "free" }`
**Expected:**
- Returns `400` error: "Invalid plan_slug"
- Cannot check out for the Free plan

```bash
curl -X POST http://localhost:3000/api/billing/create-checkout-session \
  -H "Content-Type: application/json" \
  -d '{"plan_slug": "free"}' \
  -b "cookies-from-browser"
```

| Result | Notes |
|--------|-------|
| | |

---

### BQ-016 — Unauthenticated checkout blocked 🔴
**Steps:** Call checkout API without a valid session cookie
**Expected:**
- Returns `401` "Authentication required"

| Result | Notes |
|--------|-------|
| | |

---

## SECTION 3 — Stripe Webhook 🔴

### BQ-017 — Webhook signature verified 🔴
**Steps:** Send a POST to `/api/stripe/webhook` with an invalid signature header
**Expected:**
- Returns `400` "Webhook signature invalid"
- Nothing written to `billing_events`

```bash
curl -X POST http://localhost:3000/api/stripe/webhook \
  -H "stripe-signature: t=invalid,v1=badsig" \
  -d '{}'
```

| Result | Notes |
|--------|-------|
| | |

---

### BQ-018 — checkout.session.completed handled 🔴
**Steps:** Complete a Stripe test checkout while Stripe CLI is forwarding
**Expected:**
- Stripe CLI shows: `→ POST /api/stripe/webhook [200 OK]`
- `billing_events` has row with `event_type = 'checkout.session.completed'`, `processed = true`
- `subscriptions.plan_slug` updated from `free` to the purchased plan
- `subscriptions.status = 'active'`
- `entitlements` updated with the plan's limits

| Result | Notes |
|--------|-------|
| | |

---

### BQ-019 — customer.subscription.created handled 🟡
**Steps:** Same checkout triggers both `checkout.session.completed` and `customer.subscription.created`
**Expected:**
- Both events appear in `billing_events` as processed
- Second event does not break anything (idempotent)

| Result | Notes |
|--------|-------|
| | |

---

### BQ-020 — customer.subscription.updated handled 🟡
**Steps:** Using Stripe CLI trigger:
```bash
stripe trigger customer.subscription.updated
```
**Expected:**
- Event received and processed
- `subscriptions.status` updated if changed

| Result | Notes |
|--------|-------|
| | |

---

### BQ-021 — customer.subscription.deleted handled 🔴
**Steps:** Cancel a subscription via Customer Portal or:
```bash
stripe trigger customer.subscription.deleted
```
**Expected:**
- `subscriptions.status = 'canceled'`
- `entitlements` downgraded to Free tier
- Billing page shows "Canceled" status badge

| Result | Notes |
|--------|-------|
| | |

---

### BQ-022 — invoice.payment_succeeded handled 🟡
**Steps:**
```bash
stripe trigger invoice.payment_succeeded
```
**Expected:**
- Event processed, subscription period dates updated
- `billing_events` records it

| Result | Notes |
|--------|-------|
| | |

---

### BQ-023 — invoice.payment_failed handled 🔴
**Steps:** Use Stripe test card `4000 0000 0000 0341` (always fails) then trigger:
```bash
stripe trigger invoice.payment_failed
```
**Expected:**
- `subscriptions.status = 'past_due'`
- `entitlements` downgraded to Free
- Billing page shows "Past Due" status badge + error message

| Result | Notes |
|--------|-------|
| | |

---

### BQ-024 — Duplicate Stripe events are ignored 🔴
**Steps:** Note the `id` of a processed event. Replay it using Stripe Dashboard "Resend" or manually send with the same `stripe-signature`.
**Expected:**
- Second processing attempt: `isBillingEventProcessed()` returns `true`
- Returns `200 OK` (so Stripe stops retrying)
- No duplicate rows in `billing_events`
- `subscriptions` and `entitlements` not double-written

| Result | Notes |
|--------|-------|
| | |

---

## SECTION 4 — Active Subscription Features 🔴

### BQ-025 — Plan badge updates after activation 🔴
**Steps:** After webhook processes a successful Starter checkout
**Expected:**
- Dashboard greeting shows "Starter" plan badge
- Billing page banner shows "Starter"

| Result | Notes |
|--------|-------|
| | |

---

### BQ-026 — Case limit updates for Starter (20) 🔴
**Steps:** Starter plan, try to create a 21st case
**Expected:**
- Cases 1–20 created successfully
- 21st case shows upgrade prompt
- `POST /api/billing/validate-action { action: "create_case" }` returns `{ allowed: false, limit: 20 }`

| Result | Notes |
|--------|-------|
| | |

---

### BQ-027 — Payment Lock unlocks on Starter 🔴
**Steps:** Starter plan, add a case and reach Step 2
**Expected:**
- "Require Approval" option is enabled (no lock badge)
- Can select "Require Approval" mode

| Result | Notes |
|--------|-------|
| | |

---

### BQ-028 — Formal Demand still locked on Starter 🟡
**Steps:** Starter plan, navigate to `/legal/[caseId]/demand`
**Expected:**
- `LockedFeature` card still shown
- "Boss plan required"

| Result | Notes |
|--------|-------|
| | |

---

### BQ-029 — All features unlock on Boss 🔴
**Steps:** Boss plan subscription activated
**Expected:**
- Payment Lock: ✓ enabled
- Formal Demand: renders the full demand page (no lock)
- Lawyer Referral: renders the full referral page (no lock)
- Reports: renders the full analytics dashboard (no gate)
- Cases: unlimited (meter shows "Unlimited")

| Result | Notes |
|--------|-------|
| | |

---

### BQ-030 — Evidence pack limit for Starter (5) 🟡
**Steps:** Starter plan, export 6 evidence packs across multiple cases
**Expected:**
- Packs 1–5 export successfully
- 6th export blocked: `validate-action` returns `{ allowed: false }`
- Error message shown above export button

| Result | Notes |
|--------|-------|
| | |

---

## SECTION 5 — Failed Payment / Past Due 🔴

### BQ-031 — past_due entitlement downgrade 🔴
**Steps:** Trigger `invoice.payment_failed` via Stripe CLI
**Expected:**
- `subscriptions.status = 'past_due'`
- `entitlements.plan_slug = 'free'` (or restricted)
- Paid features (Formal Demand, Lawyer Referral, Reports) locked again
- Billing page shows red "Payment Failed" banner

| Result | Notes |
|--------|-------|
| | |

---

### BQ-032 — Recovery after payment success 🟡
**Steps:** After `past_due`, trigger `invoice.payment_succeeded`
**Expected:**
- `subscriptions.status = 'active'`
- `entitlements` restored to the paid plan limits
- Features unlock again

| Result | Notes |
|--------|-------|
| | |

---

## SECTION 6 — Cancel Subscription 🔴

### BQ-033 — Customer Portal opens 🔴
**Steps:** Click "Manage Subscription" on Billing page (paid plan required)
**Expected:**
- Button shows spinner "Opening portal…"
- Redirects to `billing.stripe.com`
- Portal shows correct customer and plan

| Result | Notes |
|--------|-------|
| | |

---

### BQ-034 — Cancel at period end 🔴
**Steps:** Cancel subscription in Stripe Customer Portal
**Expected:**
- `subscriptions.cancel_at_period_end = true` after webhook
- Billing page shows amber "Cancels on [date]" warning
- Plan features still active until period ends
- After period ends: `status = 'canceled'`, entitlements → Free

| Result | Notes |
|--------|-------|
| | |

---

### BQ-035 — Portal returns to /billing 🟡
**Steps:** Click "Return to CollectBoss" or complete action in Portal
**Expected:**
- Redirects back to `/billing`

| Result | Notes |
|--------|-------|
| | |

---

### BQ-036 — Entitlements downgrade after cancellation 🔴
**Steps:** After `customer.subscription.deleted` webhook fires
**Expected:**
- `entitlements.plan_slug = 'free'`
- `entitlements.case_limit = 3`
- Paid features locked immediately

| Result | Notes |
|--------|-------|
| | |

---

## SECTION 7 — Customer Portal Security 🔴

### BQ-037 — Portal URL is server-side only 🔴
**Steps:** Inspect client-side code / network tab for portal creation
**Expected:**
- `stripe_customer_id` never appears in client-side JS bundle
- Portal URL fetched via `POST /api/billing/create-customer-portal-session`
- No `stripe_customer_id` in request body from client

| Result | Notes |
|--------|-------|
| | |

---

### BQ-038 — Cannot open portal without a subscription 🔴
**Steps:** Click "Manage Subscription" on Free account (should not appear)
**Expected:**
- `SubscriptionManagementCard` is not rendered for Free plan
- API returns `404` "No active billing account found" if called manually

```bash
curl -X POST http://localhost:3000/api/billing/create-customer-portal-session \
  -b "free-plan-user-cookies"
```

| Result | Notes |
|--------|-------|
| | |

---

### BQ-039 — Cannot open another user's portal 🔴
**Steps:** Use cookies from User A, try to open portal (it reads from DB by their business_id)
**Expected:**
- Server always looks up `stripe_customer_id` from the authenticated user's `business_id`
- Cannot inject a different `stripe_customer_id` from the request body

| Result | Notes |
|--------|-------|
| | |

---

## SECTION 8 — Security 🔴

### BQ-040 — STRIPE_SECRET_KEY not in client bundle 🔴
**Steps:** Run `npm run build`. Search the `.next` directory for the key prefix:
```bash
grep -r "sk_test_" .next/static/
```
**Expected:**
- Zero matches — secret key never in client bundle

| Result | Notes |
|--------|-------|
| | |

---

### BQ-041 — STRIPE_WEBHOOK_SECRET not in client bundle 🔴
**Steps:**
```bash
grep -r "whsec_" .next/static/
```
**Expected:**
- Zero matches

| Result | Notes |
|--------|-------|
| | |

---

### BQ-042 — Users cannot manually update entitlements 🔴
**Steps:** Use Supabase browser client / REST API to try `UPDATE entitlements SET case_limit = 9999`
**Expected:**
- Blocked by RLS: no `UPDATE` policy exists for authenticated users
- Returns RLS error

| Result | Notes |
|--------|-------|
| | |

---

### BQ-043 — Users cannot manually update subscription status 🔴
**Steps:** Try `UPDATE subscriptions SET plan_slug = 'boss', status = 'active'`
**Expected:**
- Blocked by RLS: no `UPDATE` policy for authenticated users

| Result | Notes |
|--------|-------|
| | |

---

### BQ-044 — Price IDs validated server-side 🔴
**Steps:** POST to checkout API with a custom `plan_slug` not in the allowed list
```bash
curl -X POST .../api/billing/create-checkout-session \
  -d '{"plan_slug": "enterprise"}' ...
```
**Expected:**
- Returns `400` "Invalid plan_slug"

| Result | Notes |
|--------|-------|
| | |

---

### BQ-045 — validate-action API requires auth 🔴
**Steps:** Call `POST /api/billing/validate-action` without authentication
**Expected:**
- Returns `401` "Authentication required"

| Result | Notes |
|--------|-------|
| | |

---

## SECTION 9 — Production Readiness 🔴

### BQ-046 — Test keys not used in production 🔴
**Steps:** Check Vercel env vars for production deployment
**Expected:**
- `STRIPE_SECRET_KEY` starts with `sk_live_` (not `sk_test_`)
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` starts with `pk_live_`
- Test price IDs (`price_test_...`) replaced with live price IDs

| Result | Notes |
|--------|-------|
| | |

---

### BQ-047 — All required env vars set 🔴
**Steps:** Check Vercel environment variables panel
**Expected:**
- `STRIPE_SECRET_KEY` ✓
- `STRIPE_WEBHOOK_SECRET` ✓
- `STRIPE_PRICE_STARTER` ✓
- `STRIPE_PRICE_BOSS` ✓
- `STRIPE_PRICE_PRO` ✓
- `NEXT_PUBLIC_APP_URL` ✓ (production URL)
- `SUPABASE_SERVICE_ROLE_KEY` ✓

| Result | Notes |
|--------|-------|
| | |

---

### BQ-048 — Billing page loading states work 🟡
**Steps:** Open Billing page on a slow connection (Dev Tools → Network → Slow 3G)
**Expected:**
- Plan banner shows loading skeleton while fetching
- No layout shift after load
- Subscription management card loads after entitlements

| Result | Notes |
|--------|-------|
| | |

---

### BQ-049 — Dev debug page blocked in production 🔴
**Steps:** Access `/dev/billing-debug` in production (`NEXT_PUBLIC_APP_ENV=production`)
**Expected:**
- Returns 404 or "Not available in production" message
- No billing data exposed

| Result | Notes |
|--------|-------|
| | |

---

### BQ-050 — Build passes with 0 TypeScript errors 🔴
**Steps:** `npm run build`
**Expected:**
- ✓ Compiled successfully
- ✓ TypeScript check passed
- No `Type error:` lines in output

| Result | Notes |
|--------|-------|
| | |

---

## Sign-off

| Tester | Date | Environment | Overall Result |
|--------|------|-------------|----------------|
| | | | |

**Critical failures (🔴 tests):** ___  
**Total failures:** ___  
**Go / No-Go for live launch:** ___
