# CollectBoss — Deployment Guide

## Quick Start

1. Run `supabase/schema.sql` in Supabase SQL Editor
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
2. Paste entire contents of `supabase/schema.sql`
3. Run → verify all tables created

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
| `NEXT_PUBLIC_APP_URL` | `https://app.collectboss.my` | Your production URL |
| `NEXT_PUBLIC_APP_ENV` | `production` | Disables mock data |

> ⚠️ Never add SUPABASE_SERVICE_ROLE_KEY with NEXT_PUBLIC_ prefix

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

---

## 6. Rollback Plan

If deploy fails:
1. Vercel Dashboard → Deployments → Previous deployment → Redeploy
2. Check Vercel Function logs for errors
3. Check Supabase logs for RLS or auth errors

