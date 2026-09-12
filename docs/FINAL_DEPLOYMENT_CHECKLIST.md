# CollectBoss — Final Deployment Checklist

> Superseded for the current candidate by `release/v1.0.0-rc.1/RELEASE_CHECKLIST.md`. Historical checked statements below are not evidence for the current release.
>
> **Purpose:** Last gate before deploying to Vercel production and switching Stripe to live mode.  
> Work through every section in order. All boxes must be checked before going live.

---

## 1. Build Quality

- [ ] `npm run lint` — 0 errors (warnings are acceptable)
- [ ] `npm run build` — succeeds with 0 errors
- [ ] No TypeScript errors in build output
- [ ] All new pages appear in the route list in build output

**Last verified build:** 76 pages, 0 errors (`npm run build` as of Step 31/32)

---

## 2. Code Security

- [ ] No Stripe secret key hardcoded in any source file (`grep -r "sk_live_\|sk_test_" src/`)
- [ ] No Supabase service role key hardcoded in any source file
- [ ] `SUPABASE_SERVICE_ROLE_KEY` is NOT prefixed `NEXT_PUBLIC_` in any env file
- [ ] `STRIPE_SECRET_KEY` is NOT prefixed `NEXT_PUBLIC_` in any env file
- [ ] No sensitive data (bank account, IC number, phone) in console.log statements
- [ ] No public evidence file URLs (storage bucket is private)
- [ ] Stripe price IDs are resolved server-side only — client never sends price ID

**Verified clean:** All checks above confirmed ✅ (see Step 32 security audit)

---

## 3. Vercel Environment Variables

- [ ] `NEXT_PUBLIC_SUPABASE_URL` set in Production
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY` set in Production
- [ ] `SUPABASE_SERVICE_ROLE_KEY` set in Production (server-side, no NEXT_PUBLIC_)
- [ ] `STRIPE_SECRET_KEY` set in Production — starts with `sk_live_`
- [ ] `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` set in Production — starts with `pk_live_`
- [ ] `STRIPE_WEBHOOK_SECRET` set in Production — starts with `whsec_`
- [ ] `STRIPE_PRICE_STARTER` set in Production — live price ID
- [ ] `STRIPE_PRICE_BOSS` set in Production — live price ID
- [ ] `STRIPE_PRICE_PRO` set in Production — live price ID
- [ ] `NEXT_PUBLIC_APP_URL` set in Production — exact production domain, no trailing slash
- [ ] `NEXT_PUBLIC_APP_ENV` set to `production` in Production

See `VERCEL_PRODUCTION_ENV.md` for full details.

---

## 4. Stripe Live Mode

- [ ] Stripe business verification complete (required for payouts)
- [ ] Malaysian bank account connected to Stripe for payouts
- [ ] Three live products created in Stripe Dashboard (Starter RM19, Boss RM49, Pro RM99)
- [ ] All prices are MYR, monthly recurring
- [ ] Live Price IDs copied and set in Vercel Production env
- [ ] Live API keys (`sk_live_`, `pk_live_`) copied and set in Vercel Production env
- [ ] Live webhook endpoint created: `https://YOUR_DOMAIN/api/stripe/webhook`
- [ ] All 6 webhook events selected on the live endpoint
- [ ] Live webhook signing secret (`whsec_`) copied and set in Vercel Production env
- [ ] Customer Portal activated in live mode with correct return URL

See `STRIPE_LIVE_DEPLOYMENT.md` for step-by-step instructions.

---

## 5. Supabase Production

- [ ] Supabase production project exists (separate from dev project)
- [ ] `supabase/schema.sql` applied to production project
- [ ] `supabase/billing.sql` applied to production project (plans, subscriptions, entitlements, billing_events)
- [ ] Row-Level Security (RLS) enabled on all tables — verify in Table Editor → RLS column
- [ ] Storage bucket `evidence-files` created and set to **Private**
- [ ] Storage bucket `payment-proofs` created and set to **Private**
- [ ] Auth → URL Configuration: Site URL set to production domain
- [ ] Auth → URL Configuration: Redirect URLs include `https://YOUR_DOMAIN/auth/callback`
- [ ] Auth email templates configured (OTP, password reset)
- [ ] Free plan auto-provisioning trigger works (tested during smoke test)

Key tables that must have RLS policies:
- `businesses` — user sees only their own business
- `cases` — user sees only cases belonging to their business
- `evidence_files` — user sees only evidence for their cases
- `subscriptions` — user reads only; no write via client
- `entitlements` — user reads only; write via service role (webhook) only
- `billing_events` — zero client access; service role only

---

## 6. Legal Pages

- [ ] `/terms` — Terms of Use is live and publicly accessible (no auth required)
- [ ] `/privacy` — Privacy Policy is live and publicly accessible
- [ ] `/legal-disclaimer` — Legal Disclaimer is live and publicly accessible
- [ ] `/pdpa-consent` — PDPA Consent Notice is live and publicly accessible
- [ ] `/support` — Contact & Support page is live with correct email addresses
- [ ] Landing page footer legal links point to the above pages (not `#` placeholders)
- [ ] Footer links are correct on landing page: Privacy, Terms, Legal Disclaimer, PDPA, Support

---

## 7. Billing Feature

- [ ] Free plan shows correct limits (3 cases, 1 evidence pack per case)
- [ ] Starter plan unlocks Payment Lock feature
- [ ] Boss plan unlocks Formal Demand, Lawyer Referral, Reports
- [ ] Entitlement enforcement works — feature locked when plan does not include it
- [ ] Payment Lock prevents bank account details from showing without approval
- [ ] Evidence files are not directly accessible via public storage URL
- [ ] Billing smoke test passed (see `PRODUCTION_BILLING_SMOKE_TEST.md`)

---

## 8. Payment Lock and Evidence Privacy

- [ ] Payment Lock mode "Request required" — debtor must request access before seeing bank details
- [ ] Payment Lock mode "Full lock" — bank details never shown, shared manually
- [ ] Open mode — bank details shown immediately (only for businesses that chose this)
- [ ] Payment proof upload works (`payment-proofs` storage bucket configured)
- [ ] Evidence files require authentication to access (not public URLs)
- [ ] Evidence pack PDF generation works (jsPDF)

---

## 9. Production Safety Badge

- [ ] With `NEXT_PUBLIC_APP_ENV=production`: no amber "TEST MODE" badge in sidebar (desktop)
- [ ] With `NEXT_PUBLIC_APP_ENV=production`: no "TEST MODE" badge in mobile header
- [ ] With `NEXT_PUBLIC_APP_ENV=staging` or `development`: amber badge IS shown
- [ ] `/dev/billing-debug` returns 404 when `NEXT_PUBLIC_APP_ENV=production`

---

## 10. PWA and Mobile

- [ ] App installs as PWA on mobile (iOS Safari: Share → Add to Home Screen)
- [ ] App installs as PWA on Android Chrome (install prompt or Add to Home Screen)
- [ ] App icon shows correctly on home screen (check `public/manifest.json` and icons)
- [ ] Mobile nav bar works (Dashboard, Cases, Add, Actions, More)
- [ ] Mobile header shows wordmark correctly
- [ ] Forms work on mobile keyboard (no layout breaking when keyboard opens)
- [ ] Payment flow tested on mobile

---

## 11. Desktop Dashboard

- [ ] Sidebar navigation loads for all routes
- [ ] All sidebar items link to correct pages
- [ ] Sidebar Billing link goes to `/billing`
- [ ] User avatar shows correct initials
- [ ] Sign out works
- [ ] Dashboard stats load (or show correct empty states)
- [ ] Case list renders correctly
- [ ] Evidence upload works (file drag or tap)

---

## 12. Accessibility and Performance

- [ ] All interactive elements are keyboard navigable
- [ ] Colour contrast meets WCAG AA minimum (navy on white, emerald on white)
- [ ] Images in evidence pack have alt text (or empty alt for decorative)
- [ ] Page loads in under 3 seconds on a 4G connection (check Vercel Analytics)
- [ ] No console errors on any page in production

---

## 13. Final Sign-off

| Check | Passed | Notes |
|---|---|---|
| Lint | | |
| Build | | |
| Vercel env vars | | |
| Stripe live mode | | |
| Supabase production | | |
| Legal pages | | |
| Billing smoke test | | |
| Payment Lock | | |
| PWA mobile | | |
| Desktop dashboard | | |
| Production badge | | |

**Signed off by:** ________________  
**Date:** ________________  
**Production URL:** ________________

---

## Post-Launch Actions (First 48 Hours)

- [ ] Monitor Stripe Dashboard → Webhooks → recent deliveries (all 200s)
- [ ] Monitor Supabase `billing_events` table — all `processed = true`
- [ ] Monitor Vercel function logs for any 500 errors
- [ ] Test password reset flow with a real email
- [ ] Test sign-up flow with a new email
- [ ] Respond to any user feedback via `support@collectboss.my`
