# CollectBoss — Production Environment Variable Checklist

> **When to use this document:**  
> Before deploying to Vercel production, or before switching Stripe from test mode to live mode.  
> Work through every section in order. Do not skip the security column.

---

## 1. Supabase Variables

| Variable | Required | Scope | Where to get it |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ Yes | Public (browser + server) | Supabase Dashboard → Project → Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ Yes | Public (browser + server) | Supabase Dashboard → Project → Settings → API → anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ Yes | **Server-side only** | Supabase Dashboard → Project → Settings → API → service_role key |

### Security rules — Supabase

- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are safe in the browser. RLS (Row-Level Security) protects all tables.
- `SUPABASE_SERVICE_ROLE_KEY` **must never be exposed to the browser**. It bypasses RLS entirely. It is only used in:
  - `src/lib/supabase/client.ts → getServiceClient()` (server-side only function)
  - `src/lib/billing/service.ts` (called from webhook route handler only)
  - Never in any `"use client"` component or `NEXT_PUBLIC_` variable ✅

---

## 2. Stripe Variables

| Variable | Required | Scope | Where to get it |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | ✅ Yes | **Server-side only** | Stripe Dashboard → Developers → API keys → Secret key |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | ✅ Yes | Public (browser + server) | Stripe Dashboard → Developers → API keys → Publishable key |
| `STRIPE_WEBHOOK_SECRET` | ✅ Yes | **Server-side only** | Stripe Dashboard → Webhooks → your endpoint → Signing secret |
| `STRIPE_PRICE_STARTER` | ✅ Yes | Server-side only | Stripe Dashboard → Products → Starter plan → Price ID |
| `STRIPE_PRICE_BOSS` | ✅ Yes | Server-side only | Stripe Dashboard → Products → Boss plan → Price ID |
| `STRIPE_PRICE_PRO` | ✅ Yes | Server-side only | Stripe Dashboard → Products → Pro plan → Price ID |

### Security rules — Stripe

- `STRIPE_SECRET_KEY` **must never be set as a `NEXT_PUBLIC_` variable** or imported from any `"use client"` component.  
  Verified safe: it is only read in `src/lib/stripe/server.ts` and the API route handlers. ✅
- `STRIPE_WEBHOOK_SECRET` is only read inside `src/app/api/stripe/webhook/route.ts`. ✅
- `STRIPE_PRICE_*` IDs are only read server-side via `getPriceId()`. Clients pass a plan slug, not a price ID. ✅
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is safe for the browser. It cannot be used to charge cards or read account data.

### Test vs Live keys

| Environment | Secret key prefix | Publishable key prefix |
|---|---|---|
| Test (development/staging) | `sk_test_...` | `pk_test_...` |
| Live (production) | `sk_live_...` | `pk_live_...` |

**Do not mix test keys with live price IDs or vice versa.** Stripe will reject the request.

---

## 3. App Variables

| Variable | Required | Scope | Value |
|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` | ✅ Yes | Public | Production domain, e.g. `https://app.collectboss.my` |
| `NEXT_PUBLIC_APP_ENV` | ✅ Yes | Public | `production` (on Vercel), `staging` (on preview), `development` (local) |

### How `NEXT_PUBLIC_APP_URL` is used

Used to build Stripe Checkout success/cancel redirect URLs and Stripe Customer Portal return URL.

**Must match your actual production domain.** If it is wrong, Stripe will redirect users to the wrong URL after payment.

### How `NEXT_PUBLIC_APP_ENV` is used

| Value | Behaviour |
|---|---|
| `production` | Hides mock/demo mode. Disables `/dev/billing-debug` route. Shows no Test Mode badge. |
| `staging` or `development` | Shows amber "TEST MODE" badge in sidebar and mobile header. Enables demo mode fallback. |

---

## 4. Vercel Environment Settings

### Where to add variables in Vercel

1. Go to your Vercel project → **Settings** → **Environment Variables**
2. For each variable, select the environments it applies to:

| Variable | Production | Preview | Development |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | ✅ | ✅ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | ✅ | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | ✅ | — (use .env.local) |
| `STRIPE_SECRET_KEY` | ✅ (live key) | ✅ (test key) | — (use .env.local) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | ✅ (live key) | ✅ (test key) | — (use .env.local) |
| `STRIPE_WEBHOOK_SECRET` | ✅ (live whsec) | ✅ (test whsec) | — (use .env.local) |
| `STRIPE_PRICE_STARTER` | ✅ (live price) | ✅ (test price) | — (use .env.local) |
| `STRIPE_PRICE_BOSS` | ✅ (live price) | ✅ (test price) | — (use .env.local) |
| `STRIPE_PRICE_PRO` | ✅ (live price) | ✅ (test price) | — (use .env.local) |
| `NEXT_PUBLIC_APP_URL` | ✅ (prod URL) | ✅ (Vercel preview URL) | — (use .env.local) |
| `NEXT_PUBLIC_APP_ENV` | `production` | `staging` | — (use .env.local) |

> **Tip:** For preview deployments, use Stripe test mode keys. Only production gets live keys.

### Vercel build settings

| Setting | Value |
|---|---|
| Framework | Next.js (auto-detected) |
| Build command | `npm run build` |
| Install command | `npm install` |
| Output directory | `.next` (default) |
| Node.js version | 20.x or later |

---

## 5. Local Development (.env.local)

Copy `.env.local.example` to `.env.local` and fill in your values.  
`.env.local` is in `.gitignore` and must never be committed.

```bash
cp .env.local.example .env.local
```

Use **test mode Stripe keys** (`sk_test_...`, `pk_test_...`) in `.env.local`.  
Use test Stripe price IDs (`price_test_...`) in `.env.local`.

---

## 6. Pre-Deploy Security Checklist

Run through this before every production deployment:

- [ ] `STRIPE_SECRET_KEY` starts with `sk_live_` in production Vercel env
- [ ] `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` starts with `pk_live_` in production Vercel env
- [ ] `SUPABASE_SERVICE_ROLE_KEY` is set in Vercel but NOT prefixed `NEXT_PUBLIC_`
- [ ] `STRIPE_WEBHOOK_SECRET` is set in Vercel (the `whsec_` for the live webhook endpoint)
- [ ] All three `STRIPE_PRICE_*` variables point to live-mode price IDs (not test IDs)
- [ ] `NEXT_PUBLIC_APP_URL` is set to the live production domain
- [ ] `NEXT_PUBLIC_APP_ENV` is set to `production`
- [ ] No secret variables are logged or returned in API responses
- [ ] `.env.local` is in `.gitignore` (it is — verified) ✅
- [ ] The `/dev/billing-debug` route returns 404 in production ✅

---

## 7. Verification After Deploy

After deploying to production:

1. Visit `/billing` — the plan cards should load without errors
2. Start a test checkout with Stripe test card `4242 4242 4242 4242` (if still in test mode)
3. Check Stripe Dashboard → Events — webhook events should arrive and be marked as delivered
4. Check Supabase → `billing_events` table — events should be recorded
5. Check Supabase → `subscriptions` and `entitlements` tables — plan should update after checkout
