# CollectBoss production connection matrix

> Historical baseline: this matrix predates the implemented tenant membership/role, document-intake, compliance, and integration-recovery work. It must not be used as current Commercial V1 release evidence. Use `docs/COMMERCIAL_V1_RELEASE_VALIDATION.md` and `release/v1.0.0-rc.1/RELEASE_CHECKLIST.md`.

**Scope:** current implementation, verified against `src/app`, `src/lib`, and the Supabase SQL files on 2026-07-13. This is an as-built production reference; it does not describe planned application logic.

## Role model and access boundary

| Requested role | Current implementation | Route access and enforcement |
| --- | --- | --- |
| Customer | **Debtor / public participant**, not an authenticated application role. | May use `/pay/[caseId]` and `/acknowledge/[caseId]`; applicable RLS policies allow payment-access requests, payment-proof submission, and plan confirmation. |
| Staff | **Not implemented.** There is no staff table, membership model, role claim, or staff-only route/RLS policy. | No production access should be granted as “Staff” until role-based authorization is implemented. |
| Admin | **Not implemented as an application role.** The business owner is the only authenticated application actor. Supabase/Stripe project administrators operate outside this application. | Authenticated owner routes are protected by `src/proxy.ts`; RLS scopes records to `businesses.owner_id = auth.uid()`. |

`actor_type` values in the schema (`owner`, `system`, `debtor`) are audit labels, not an authorization role system. “Owner” below means the authenticated business owner. Routes not explicitly public are redirected to `/login` when Supabase is configured. In mock mode this protection is intentionally bypassed, so mock mode must never be used for production validation.

## Screens and routes

**Legend:** `—` means no direct persistence or storage use. “Error” is the observable failure state to exercise; database-service failures surface the returned Supabase error in the relevant UI. Billing entitlement blocks are deliberate product states, not transport failures.

| Route/path | Component file | User role | Data source / table | Storage bucket | API/service file | Allowed actions | Error states | Production test case |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/` | `src/components/pages/home-dashboard.tsx`, `home-mobile.tsx` | Owner | cases, payments, reminders | — | `src/lib/db/cases-client.ts`, `payments-client.ts`, `reminders-client.ts` | View case dashboard and navigate | no business/data load failure | Owner sees only own metrics/cases |
| `/landing`, `/beta-welcome` | `src/components/pages/landing-page.tsx`, `beta-welcome-page.tsx` | Public | Static content | — | — | Read, start sign-up | broken navigation | Links and CTA load without auth |
| `/login`, `/signup` | `src/components/pages/auth/login-page.tsx`, `signup-page.tsx` | Public / owner | Supabase Auth | — | `src/lib/auth/session.ts` | Sign in; create account | invalid credentials; duplicate email; auth unavailable | Sign up, verify/login, then reach onboarding |
| `/forgot-password`, `/reset-password`, `/auth/callback` | `src/components/pages/auth/forgot-password-page.tsx`, `reset-password-page.tsx`; `src/app/auth/callback/route.ts` | Public | Supabase Auth | — | `src/lib/auth/session.ts`; callback route | Request/reset password; exchange auth code | invalid/expired token; missing code; auth unavailable | Reset password and log in with new password |
| `/onboarding/profile` | `src/components/pages/onboarding/business-profile-page.tsx` | Owner | `businesses`, `receiving_accounts` | — | `businesses-client.ts`, `receiving-accounts-client.ts` | Create business/profile and account setup | validation; duplicate/DB failure | Complete profile and confirm owner-scoped business row |
| `/cases`, `/cases/[id]`, `/add` | `src/components/pages/cases-page.tsx`, `case-detail-page.tsx`, `add-case-page.tsx` | Owner | `cases`; detail also evidence, reminders, payments, plans, documents, referrals | evidence-files, payment-proofs | `cases-client.ts` plus feature services below | List, create, view, update status/action/lock mode | not found; validation; RLS/DB failure; entitlement block | Create case, reload, edit, and verify another owner cannot read it |
| `/actions` | `src/components/pages/actions-page.tsx` | Owner | cases and feature availability | — | `cases-client.ts`, `src/lib/billing/entitlements.ts` | Select next collection action | load failure; feature locked | Select action from a live case and open destination |
| `/reminders/[caseId]` | `src/components/pages/reminder-generator-page.tsx` | Owner | `cases`, `reminders`, `receiving_accounts` | — | `reminders-client.ts`, `src/lib/reminders/generator.ts` | Generate/copy/log/update reminder status | missing case/account; save failure | Save draft/sent reminder and confirm timeline entry |
| `/evidence/[caseId]` | `src/components/pages/legal/evidence-upload-page.tsx` | Owner | `evidence_files`, cases | `evidence-files` | `src/lib/db/evidence-client.ts` | Upload, list, signed-view, delete evidence | invalid type; >10 MB; upload/delete/signing failure | Upload PDF/JPG, open signed URL, then delete it |
| `/evidence/[caseId]/checklist`, `/evidence/[caseId]/pack` | `src/components/pages/legal/evidence-checklist-page.tsx`, `evidence-pack-page.tsx` | Owner | evidence_files, cases, reminders, payments, legal_documents | evidence-files | `evidence-client.ts`, `legal-documents-client.ts`, `src/lib/pdf/evidence-pack-generator.ts` | Review completeness; generate/download/save pack | missing case; export entitlement block; save/export failure | Generate an evidence-pack PDF for a populated case |
| `/documents` | `src/components/pages/legal/documents-index-page.tsx` | Owner | `legal_documents`, `lawyer_referrals`, cases | — | `legal-documents-client.ts`, `lawyer-referrals-client.ts` | Browse generated documents/referrals | load failure; empty state | Generate a document and confirm it appears |
| `/legal/[caseId]/demand`, `/legal/[caseId]/smallclaim` | `src/components/pages/legal/formal-demand-page.tsx`, `small-claim-page.tsx` | Owner | cases, legal_documents, evidence/reminders/payments | — | `legal-documents-client.ts`; `src/lib/pdf/demand-generator.ts`, `small-claim-generator.ts` | Draft/download demand or small-claim material | missing case; entitlement block; PDF/save failure | Produce each PDF and verify case data is correct |
| `/legal/[caseId]/plan`, `/legal/[caseId]/acknowledge` | `src/components/pages/legal/payment-plan-page.tsx`, `debt-acknowledgement-page.tsx` | Owner | `cases`, `payment_plans`, `legal_documents` | — | `payment-plans-client.ts`, `legal-documents-client.ts` | Create plan; prepare acknowledgement | invalid installments; save failure | Create plan then open its debtor acknowledgement flow |
| `/legal/[caseId]/lawyer` | `src/components/pages/legal/lawyer-referral-page.tsx` | Owner | `cases`, `lawyer_referrals` | — | `src/lib/db/lawyer-referrals-client.ts` | Create/update referral | entitlement block; save failure | Create referral and change its status |
| `/pay/[caseId]` | `src/components/pages/payments/debtor-payment-page.tsx` | Customer (public debtor) | cases (limited server read), receiving_accounts, payment_access_requests, payments | `payment-proofs` | `src/lib/db/cases.ts`, `payment-access-client.ts`, `payments-client.ts` | Request access; submit payment/proof when allowed | case not found; expired/rejected access; upload/create failure | Submit proof under each lock mode; owner approves/rejects it |
| `/acknowledge/[caseId]` | `src/components/pages/legal/debtor-acknowledgement-page.tsx` | Customer (public debtor) | cases (limited server read), payment_plans | — | `src/lib/db/cases.ts`, `payment-plans-client.ts` | Review and confirm plan | case/plan not found; confirmation failure | Confirm active plan and verify `debtor_confirmed` |
| `/payments`, `/payments/record/[caseId]` | `src/components/pages/payments/payment-history-page.tsx`, `record-payment-page.tsx` | Owner | payments, cases | `payment-proofs` | `payments-client.ts`, `cases-client.ts` | List; record approved internal payment; upload proof | missing case; invalid amount; upload/save failure | Record payment and verify case amount/status update |
| `/payments/account`, `/payments/access/[caseId]` | `src/components/pages/payments/receiving-account-page.tsx`, `payment-access-settings-page.tsx` | Owner | `receiving_accounts`, cases | `duitnow-qr` is schema-declared but no upload client is implemented | `receiving-accounts-client.ts`, `cases-client.ts` | Manage accounts; set case lock mode | validation; one-primary constraint; save failure | Create two accounts, set primary, change lock mode |
| `/payments/requests`, `/payments/requests/[requestId]` | `src/components/pages/payments/payment-requests-page.tsx`, `approve-request-page.tsx` | Owner | `payment_access_requests`, cases | — | `payment-access-client.ts` | Review, approve, reject, manually send access | request not found/expired; update failure | Approve a debtor request and verify access expiry |
| `/reports` | `src/components/pages/reports-page.tsx` | Owner | cases, payments, reminders (client aggregates) | — | `src/lib/analytics/case-stats.ts`, client DB services | View collection report | load failure; reports entitlement block | Compare totals with case/payment records |
| `/settings` | `src/components/pages/business-settings-page.tsx` | Owner | businesses, receiving_accounts | — | `businesses-client.ts`, `receiving-accounts-client.ts` | Update business settings/accounts | validation or save failure | Update business details and reload |
| `/billing`, `/billing/success`, `/billing/cancel` | `src/components/pages/billing-page.tsx`; inline page components | Owner | plans, subscriptions, entitlements, billing_events | — | `src/lib/billing/client.ts`; `/api/billing/create-checkout-session`; `/api/billing/create-customer-portal-session`; Stripe webhook | View plan, checkout, manage subscription | missing configuration; auth/Stripe/API failure; delayed webhook | Complete test/live checkout; confirm webhook updates subscription/entitlement |
| `/dev/billing-debug` | `src/components/pages/dev/billing-debug-page.tsx` | Owner, non-production only | plans, subscriptions, entitlements | — | `src/lib/billing/client.ts` | Inspect safe billing configuration | 404 in production; unavailable data | Confirm production returns 404 |
| `/more` | `src/components/pages/more-page.tsx` | Owner | Static navigation/auth state | — | `src/lib/auth/session.ts` | Navigate, sign out | sign-out failure | Sign out and confirm protected route redirects |
| `/terms`, `/privacy`, `/legal-disclaimer`, `/pdpa-consent`, `/support` | matching files in `src/components/pages/legal-pages/` | Public | Static content | — | — | Read legal/support content | broken route | Every policy page returns 200 unauthenticated |

## Backend services

| Required service | Implementation/status | Files and production responsibility |
| --- | --- | --- |
| Supabase client | Implemented | `src/lib/supabase/client.ts`: browser, cookie-backed server, and server-only service-role clients. The service key is only for server operations. |
| Auth service | Implemented | `src/lib/auth/session.ts`, `src/app/auth/callback/route.ts`, `src/proxy.ts`. Supabase Auth handles sign-up, password reset, session refresh, and protected-route redirects. |
| Event service | Partially implemented: billing event processing only; no general event domain service. | `src/app/api/stripe/webhook/route.ts`, `src/lib/billing/service.ts`, `billing_events`. Stripe event IDs are deduplicated and recorded. |
| Photo upload service | Implemented only as generic evidence/proof uploads; no separate photo service. | `src/lib/db/evidence-client.ts` → `evidence-files`; `src/lib/db/payments-client.ts` → `payment-proofs`. Allowed evidence types: PDF/PNG/JPG/JPEG; max 10 MB. |
| Gallery service | **Not implemented.** | No gallery tables, routes, client, or storage access policy found. |
| Booking service | **Not implemented.** | No booking tables, routes, service, or API found. |
| Staff checklist service | **Not implemented.** | No staff identity/assignment or checklist model found. The evidence checklist is owner-facing and static, not a staff-checklist service. |
| Case/collection service | Implemented | `src/lib/db/cases-client.ts`, `reminders-client.ts`, `payment-access-client.ts`, `payments-client.ts`, `payment-plans-client.ts`. |
| Legal document service | Implemented | `src/lib/db/legal-documents-client.ts`, `lawyer-referrals-client.ts`, `src/lib/pdf/*-generator.ts`. |
| Billing service | Implemented | API billing routes, `src/lib/stripe/server.ts`, `src/lib/billing/{client,service,entitlements}.ts`. Stripe webhook owns subscription/entitlement writes. |

### Persistence and storage inventory

| Database tables | Purpose |
| --- | --- |
| `businesses`, `cases`, `evidence_files`, `reminders`, `receiving_accounts` | Owner-scoped business and collection records |
| `payment_access_requests`, `payments`, `payment_plans` | Debtor payment access, proof/review, and installment plans |
| `legal_documents`, `lawyer_referrals`, `audit_logs` | Legal workflow and audit trail |
| `plans`, `subscriptions`, `entitlements`, `billing_events` | Billing catalog, Stripe-managed subscription state, feature limits, webhook audit |

| Bucket | Status and use |
| --- | --- |
| `evidence-files` | Private; used by evidence upload service. |
| `payment-proofs` | Private; used by debtor/owner payment-proof upload service. |
| `legal-documents` | Not declared by the canonical schema; no current upload client found. |
| `duitnow-qr` | Not declared by the canonical schema; QR URL is stored on `receiving_accounts`, but no current upload client found. |

## Environment variables

Never place a secret in a `NEXT_PUBLIC_` variable. Public values are bundled into browser code; secrets are server-only.

| Variable | Visibility | Local | Preview | Production | Used by |
| --- | --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Public | Local Supabase/project URL | Preview project URL | Production project URL | Supabase browser/server clients |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public | Local/project anon key | Preview anon key | Production anon key | Supabase browser/server clients; RLS is mandatory |
| `NEXT_PUBLIC_APP_URL` | Public | `http://localhost:3000` | Exact preview deployment URL | Exact canonical production URL, no trailing slash | Stripe success/cancel/portal return URLs |
| `NEXT_PUBLIC_APP_ENV` | Public | `development` | `staging` | `production` | Disables mock/test indicators and production-blocks debug page |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Public | `pk_test_…` | `pk_test_…` | `pk_live_…` | Client-side billing configuration |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret | Local project service key | Preview service key | Production service key | `getServiceClient()` and billing writes only |
| `STRIPE_SECRET_KEY` | Secret | `sk_test_…` | `sk_test_…` | `sk_live_…` | Checkout, portal, webhook server code |
| `STRIPE_WEBHOOK_SECRET` | Secret | Stripe CLI/local endpoint secret | Preview endpoint secret | Production webhook endpoint secret | Signature verification in `/api/stripe/webhook` |
| `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_BOSS`, `STRIPE_PRICE_PRO` | Secret/server config | Test Price IDs | Test Price IDs | Live Price IDs | Checkout and webhook plan mapping |

## Manual production test checklist

- [ ] Set all production variables above in the deployment platform; verify `NEXT_PUBLIC_APP_ENV=production`, production URLs, `pk_live_…`, `sk_live_…`, and live Stripe Price IDs.
- [ ] Apply `supabase/schema.sql`, reviewed `supabase/migrations/*`, and `supabase/billing.sql` to the production Supabase project; create private `evidence-files` and `payment-proofs` buckets and verify their policies.
- [ ] Confirm unauthenticated protected routes redirect to `/login`; public legal, `/pay/[caseId]`, and `/acknowledge/[caseId]` remain reachable.
- [ ] Create two owner accounts/businesses. Verify each can create and manage only its own business, case, evidence, payments, plans, documents, and receiving accounts.
- [ ] Complete business onboarding; add a primary receiving account; create, edit, and reload a case.
- [ ] Upload and delete a permitted evidence file; reject unsupported and over-10-MB files; confirm signed access works only for authorized data.
- [ ] Generate and log a reminder; record an internal payment; verify the case balance/status changes only once.
- [ ] Use the debtor payment page with immediate, approval, and manual lock modes; submit a proof; approve and reject a request/payment from the owner flow.
- [ ] Create and confirm a payment plan; generate a demand, small-claim, and evidence-pack PDF; confirm saved legal records are owner-scoped.
- [ ] Run live checkout for each paid plan, receive the Stripe webhook, and verify `subscriptions` and `entitlements` update. Exercise customer-portal return.
- [ ] Send a duplicate Stripe webhook event and confirm it is safely deduplicated in `billing_events`; send an invalid signature and confirm rejection.
- [ ] Confirm `/dev/billing-debug` returns 404 in production and no test-mode badge or mock data is visible.
- [ ] Confirm error pages/states for Supabase outage, invalid login/reset token, absent case, RLS denial, failed upload, Stripe API failure, and webhook delay are understandable and do not expose secrets.
- [ ] Record the explicit acceptance decision for the gaps: Staff/Admin role enforcement, event/gallery/booking/staff-checklist services, and unused `legal-documents`/`duitnow-qr` upload paths are not implemented.
