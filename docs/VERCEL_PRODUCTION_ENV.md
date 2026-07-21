# CollectBoss — Vercel Production Environment Variables

> **Purpose:** Complete reference for every environment variable required to run CollectBoss on Vercel.  
> **Where to set them:** Vercel project → Settings → Environment Variables.  
> **Rule:** Production uses live Stripe keys. Preview uses test Stripe keys. Never mix them.

---

## 1. Supabase Variables

These must be set in **Production** and **Preview** (each may use a different Supabase project if you have a separate staging DB).

| Variable | Scope | Description |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Public | Your Supabase project URL. Format: `https://xxxx.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public | Anon (public) key. Safe for browser. RLS protects all data. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server-side only** | Service role key. Bypasses RLS. **Must NOT be prefixed `NEXT_PUBLIC_`**. |

**Where to find them:**  
Supabase Dashboard → your project → Settings → API → "Project URL" and "API Keys"

### Security rule

`SUPABASE_SERVICE_ROLE_KEY` bypasses all Row-Level Security. If exposed to the browser, any user could read or write any row in your database.

- Never set it as `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY`
- Only used in server-side code: `src/lib/supabase/client.ts → getServiceClient()` and `src/lib/billing/service.ts`
- Verified: no client component imports these functions ✅

---

## 2. Stripe Variables

### Production environment — LIVE MODE keys

| Variable | Scope | Description |
|---|---|---|
| `STRIPE_SECRET_KEY` | **Server-side only** | Live secret key. Starts with `sk_live_`. Never expose to browser. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Public | Live publishable key. Starts with `pk_live_`. Safe for browser. |
| `STRIPE_WEBHOOK_SECRET` | **Server-side only** | Live webhook signing secret. Starts with `whsec_`. |
| `STRIPE_PRICE_STARTER` | Server-side only | Live Price ID for Starter plan (RM 19/mo). Starts with `price_live_`. |
| `STRIPE_PRICE_BOSS` | Server-side only | Live Price ID for Boss plan (RM 49/mo). Starts with `price_live_`. |
| `STRIPE_PRICE_PRO` | Server-side only | Live Price ID for Pro plan (RM 99/mo). Starts with `price_live_`. |

### Preview / Staging environment — TEST MODE keys

| Variable | Value format |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_...` |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_test_...` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_test_...` (from test mode webhook endpoint) |
| `STRIPE_PRICE_STARTER` | `price_test_...` (test mode Starter price ID) |
| `STRIPE_PRICE_BOSS` | `price_test_...` (test mode Boss price ID) |
| `STRIPE_PRICE_PRO` | `price_test_...` (test mode Pro price ID) |

### Critical rules

| Rule | Reason |
|---|---|
| ❌ Never use `sk_live_` in Preview or local dev | Will charge real customers during testing |
| ❌ Never set `STRIPE_SECRET_KEY` as `NEXT_PUBLIC_STRIPE_SECRET_KEY` | Exposes the key in browser bundle — account takeover risk |
| ❌ Never commit `.env.local` with real keys | Gets committed to git history and is irrecoverable |
| ✅ Use Vercel environment selector to restrict live keys to Production only | Prevents accidental live charges in preview |
| ✅ Rotate the secret key immediately if it is ever accidentally exposed | Stripe Dashboard → Developers → API keys → Roll key |

---

## 3. App Variables

| Variable | Production value | Preview value | Local dev value |
|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` | `https://app.collectboss.my` | Vercel preview URL, e.g. `https://collectboss-abc123.vercel.app` | `http://localhost:3000` |
| `NEXT_PUBLIC_APP_ENV` | `production` | `staging` | `development` |

### How `NEXT_PUBLIC_APP_URL` is used in the codebase

| Code location | Use |
|---|---|
| `src/app/api/billing/create-checkout-session/route.ts` | Builds Stripe Checkout `success_url` and `cancel_url` |
| `src/app/api/billing/create-customer-portal-session/route.ts` | Builds Stripe Customer Portal `return_url` |
| `src/app/api/cases/[caseId]/public-links/route.ts` | Builds public payment and acknowledgement links |

If `NEXT_PUBLIC_APP_URL` is wrong or missing, redirects and public links can point to the wrong host. Production blocks these routes unless it is set to the exact HTTPS deployment URL (no trailing slash).

### How `NEXT_PUBLIC_APP_ENV` is used in the codebase

| Code location | Behaviour when set to `production` |
|---|---|
| `src/components/ui/env-mode-badge.tsx` | Hides amber "TEST MODE" badge from sidebar and mobile header |
| `src/app/dev/billing-debug/page.tsx` | Returns 404 — debug route is inaccessible |
| `src/lib/supabase/client.ts` | Logs a CRITICAL error to console if Supabase is not configured |

---

## 4. Vercel Environment Variable Setup — Step by Step

1. Open [vercel.com](https://vercel.com) → your CollectBoss project
2. Go to **Settings** → **Environment Variables**
3. For each variable, click **Add New**:
   - Paste the variable name
   - Paste the value
   - Select the correct **Environment** checkbox: ✅ Production, ☐ Preview, ☐ Development (or as specified above)
   - Click **Save**

4. After adding all variables, go to **Deployments** → click **Redeploy** on the latest deployment
   - Or push a new commit: `git push origin main`

5. Wait for the build to complete and verify the production URL is live

---

## 5. Local Development (.env.local)

Copy `.env.local.example` to `.env.local` for local development:

```bash
cp .env.local.example .env.local
```

Use **test mode** Stripe keys in `.env.local`. Set `NEXT_PUBLIC_APP_ENV=development`.

`.env.local` is listed in `.gitignore` and must never be committed.

---

## 6. Quick Reference — All Variables

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...           ← server-side only, NOT NEXT_PUBLIC_

# Stripe (Production = live keys, Preview = test keys)
STRIPE_SECRET_KEY=sk_live_...              ← server-side only, NOT NEXT_PUBLIC_
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...            ← server-side only, NOT NEXT_PUBLIC_
STRIPE_PRICE_STARTER=price_live_...
STRIPE_PRICE_BOSS=price_live_...
STRIPE_PRICE_PRO=price_live_...

# App
NEXT_PUBLIC_APP_URL=https://app.collectboss.my
NEXT_PUBLIC_APP_ENV=production
```

---

## 7. After Setting Variables

Run through this checklist before triggering a production deploy:

- [ ] All 11 variables are set in Vercel Production environment
- [ ] `STRIPE_SECRET_KEY` starts with `sk_live_` in Production (not `sk_test_`)
- [ ] `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` starts with `pk_live_` in Production
- [ ] `SUPABASE_SERVICE_ROLE_KEY` is NOT prefixed `NEXT_PUBLIC_`
- [ ] `NEXT_PUBLIC_APP_URL` matches the exact production domain (no trailing slash)
- [ ] `NEXT_PUBLIC_APP_ENV` is `production` in Production environment
- [ ] Preview environment still uses `sk_test_` / `pk_test_` keys
- [ ] No variable value was copied from a `.env.local` that contained a live key accidentally
