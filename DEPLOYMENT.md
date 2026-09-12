# CollectBoss — Deployment Guide

## Quick Start

1. Run `supabase/schema.sql`, then reviewed files in `supabase/migrations/`, in Supabase SQL Editor
2. Add env vars to Vercel
3. Push to GitHub → auto-deploy on Vercel

---

## 1. Supabase Production Setup

### Create Project
1. Go to https://supabase.com → New Project
2. Region: Southeast Asia (Singapore)
3. Note your: Project URL, Anon Key, Service Role Key

### Run Schema
1. Dashboard → SQL Editor → New Query
2. Paste and run `supabase/schema.sql` (the canonical base schema)
3. Paste and run each reviewed migration in `supabase/migrations/` in filename order
4. Run `supabase/billing.sql` after the base schema
5. Verify all tables and RLS policies were created; do not use `src/lib/supabase/schema.sql`

### Storage Buckets
1. Dashboard → Storage → Create Bucket
2. Create: **evidence-files** (Private)
3. Create: **payment-proofs** (Private)
4. For each bucket, add Storage Policy:
   - INSERT: `(auth.uid() IS NOT NULL)`
   - SELECT: `(auth.uid() IS NOT NULL)`
   - DELETE: `(auth.uid() IS NOT NULL)`

### Authentication Settings
1. Dashboard → Authentication → Settings
2. Enable: Email (with OTP / Magic Link)
3. Disable: Email confirmations (optional for MVP)
4. Site URL: `https://your-app.vercel.app`
5. Redirect URLs: add `https://your-app.vercel.app/auth/callback`

### Email Templates (optional)
1. Dashboard → Authentication → Email Templates
2. Customize confirmation email with CollectBoss branding

---

## 2. Vercel Deployment

### Connect Repository
1. https://vercel.com → New Project → Import from GitHub
2. Framework: Next.js (auto-detected)
3. Root Directory: `collectboss` (if monorepo)

### Build Settings (auto-detected by Vercel)
- Build Command: `npm run build`
- Output Directory: `.next`
- Install Command: `npm install`
- Node.js Version: 20.x

### Environment Variables (add in Vercel Dashboard)

| Variable | Value | Notes |
|----------|-------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xxx.supabase.co` | Required |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJ...` | Required |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` | Optional — server-side only |
| `CRON_SECRET` | strong random value | Required for scheduled domain-event detection |
| `NEXT_PUBLIC_APP_URL` | `https://app.collectboss.my` | Your production URL |
| `NEXT_PUBLIC_APP_ENV` | `production` | Disables mock data |

> ⚠️ Never add SUPABASE_SERVICE_ROLE_KEY with NEXT_PUBLIC_ prefix

### Recovery domain-event scheduler

`vercel.json` registers `GET /api/cron/domain-events` hourly at minute 5 UTC.
Vercel supplies `Authorization: Bearer $CRON_SECRET`. The database detector
evaluates each business in its configured timezone, so the UTC invocation time
does not determine the tenant's recovery date. The endpoint creates internal
domain events, then projects them into persistent creditor notifications. It
then projects actionable event types into the separate Action Centre using
deterministic priority rules. It does not send debtor messages, and
informational/positive notifications do not become work automatically.

### Custom Domain (optional)
1. Vercel Dashboard → Project → Settings → Domains
2. Add your domain: `app.collectboss.my`
3. Follow DNS setup instructions
4. Update Supabase → Auth → Site URL with new domain
5. Add new domain to Supabase Redirect URLs

---

## 3. PWA Icons (Required before launch)

The current `public/icons/icon.svg` is a placeholder.

Generate proper PNG icons before launch:
1. Go to https://realfavicongenerator.net
2. Upload a 512×512 PNG of the CollectBoss logo
3. Download the icon pack
4. Place `icon-192.png` and `icon-512.png` in `public/icons/`
5. Replace `public/favicon.svg` with `favicon.ico`

---

## 4. Post-Deploy Verification

Test these flows after deploy:

- [ ] Sign up with new email
- [ ] Receive OTP email
- [ ] Complete business profile
- [ ] Create a case
- [ ] Upload evidence file
- [ ] Access `/pay/[caseId]` without login (should work)
- [ ] Access `/acknowledge/[caseId]` without login (should work)
- [ ] Access `/cases` without login (should redirect to /login)
- [ ] Create payment plan, debtor confirms via /acknowledge link
- [ ] Submit payment proof as debtor
- [ ] Verify notification bell unread count, deep link, mark-read and mark-all-read persistence
- [ ] Verify Today action counts, amount represented, completion history and controlled snooze
- [ ] Approve payment proof as creditor — verify balance updates
- [ ] Export evidence pack PDF
- [ ] Save formal demand draft

---

## 5. Security Checklist

- [ ] Supabase RLS policies enabled on all tables
- [ ] Storage buckets set to Private
- [ ] `SUPABASE_SERVICE_ROLE_KEY` NOT exposed as NEXT_PUBLIC_
- [ ] `NEXT_PUBLIC_APP_ENV=production` set in Vercel
- [ ] Supabase Auth redirect URLs updated to production domain
- [ ] No `.env.local` committed to git
- [ ] `PAYMENT_ACCESS_OTP_PEPPER` is a production-only secret of at least 32 characters
- [ ] Email OTP delivery has `RESEND_API_KEY` and `PAYMENT_OTP_FROM_EMAIL`
- [ ] SMS OTP delivery has `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER`
- [ ] Receiving accounts exposed by secure links have `verification_status = 'verified'`
- [ ] R14 industry risk policies have been reviewed and approved for the deployment
- [ ] Platform safety reviewers use only the service-role verification/report decision RPCs
- [ ] A named operational owner monitors the platform abuse review queue
- [ ] Verification copy is described as a CollectBoss review, never government or regulatory verification

---

## 6. Rollback Plan

If deploy fails:
1. Vercel Dashboard → Deployments → Previous deployment → Redeploy
2. Check Vercel Function logs for errors
3. Check Supabase logs for RLS or auth errors
