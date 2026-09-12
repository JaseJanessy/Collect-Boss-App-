# Corporate refresh and connectivity QA

Updated: 7 September 2026. Status: implementation and local verification; **not production-ready**.

## Outcome

The shared web design system, public entry pages, authentication pages, Main shell, Main account hub and Pocket shell have been refreshed. Navy navigation, quieter surfaces, consistent typography, clearer grouping, accessible focus states and larger phone controls replace the previous mixture of promotional and operational styling. Malaysia-specific currency and product scope have not been represented as worldwide payment or legal coverage.

Main and Pocket deliberately share Supabase authentication and a business identity. They are separate product experiences, not unrestricted interchangeable dashboards. The existing owner-authorized Pocket-to-Solo/Main upgrade flow remains the supported transition; this work does not bypass its entitlement or financial reconciliation checks.

## Live connectivity findings

The read-only audit is `scripts/release/verify-workspace-connectivity.mjs`. Its generated evidence is `output/verification/workspace-connectivity.json`. A fresh run on 7 September confirmed the same missing dependencies and correctly exited nonzero; it is not a passing connectivity gate.

| Check | Observed result | Meaning |
| --- | --- | --- |
| Supabase authentication health | HTTP 200 | Auth service is reachable, not proof of a successful user login. |
| Email authentication provider | Enabled | Delivery, confirmation links and individual accounts still require testing. |
| Supabase REST schema | HTTP 200 | A database connection exists. |
| Zero-row HEAD on businesses | HTTP 200 | Existing business interface is available. |
| Zero-row HEAD on business_memberships | HTTP 404 | Required membership interface is unavailable. |
| Zero-row HEAD on workspace_product_states | HTTP 404 | Product routing cannot reliably resolve a workspace. |
| Zero-row HEAD on obligations | HTTP 404 | Shared receivables interface is unavailable. |
| Zero-row HEAD on payment_allocations | HTTP 404 | Shared payment-allocation interface is unavailable. |
| Web/mobile Supabase configuration | Same project and public key | They target the same authentication backend. |
| Mobile API base URL | Missing | Phone workspace provisioning, product resolution and uploads cannot work as configured. |
| Current web app URL | localhost | Not a deployable backend address for a physical phone. |

The service-role OpenAPI inventory exposes 22 of 109 literal table/view references and 8 of 109 literal RPC references found in application source. These are diagnostic counts, **not an exact migration count**: role-specific grants and storage-bucket references affect this comparison. The HEAD probes independently confirm several critical missing REST interfaces without reading any business records.

No live account was created, no password was changed, no messages or charges were sent, and no production SQL was applied. No credentials are included in the evidence files.

## Architecture verification

| Workflow | Application boundary | Required shared backend |
| --- | --- | --- |
| Sign in and account recovery | Supabase Auth, server callback, request-cookie refresh | Auth session plus PKCE recovery validation |
| Workspace selection | `/api/workspace/context`, tenant/bearer permission checks | businesses, business_memberships, business_role_settings, workspace_product_states |
| Main access and plans | Server authorization plus effective entitlement view | entitlements, subscriptions, permission RPCs |
| Pocket access and plans | Pocket workspace gate and capability checks | workspace_product_states, workspace_commercial_states, pocket_get_entitlements |
| Pocket customer/debt ledger | Pocket APIs scoped to authorized business | debtors, obligations; Pocket obligations filtered by origin_product_type |
| Pocket payments | Validated, idempotent payment operations | payment_receipts, payment_allocations, Pocket payment RPCs |
| Pocket-to-Main upgrade | Existing owner-only upgrade service | upgrade runs/items and reconciliation/commit RPCs |
| Native companion | Shared Supabase session and bearer-authenticated web APIs | Reachable EXPO_PUBLIC_API_BASE_URL plus the above schema |

Repository inventory: 82 page modules and 155 API route modules. A successful production build checks compilation/routing across these modules; it does not establish that every authenticated workflow works against the live database.

## Five business-user scenarios

These are simulated scenario assessments using the local browser/runtime evidence, not five real participants or five authenticated Supabase accounts. They identify what is covered and what still requires staging.

| Business user | Debt-management need | Evidence and outstanding check |
| --- | --- | --- |
| First-time contractor | Understand the product and register for overdue-invoice tracking | Public product explanation, signup labels/validation and responsive navigation checked. Email confirmation and live workspace creation remain unverified. |
| Wholesale business owner | Find an overdue case and review its payment history | Main case search layout and complete case-tab navigation checked with fixtures. Saving a real case/payment requires the missing schema. |
| Finance employee | Work within permissions and distinguish an outage from an empty queue | Permission/error-state tests and unavailable Action Centre presentation checked. Two-business staff/RLS isolation requires staging accounts. |
| Phone-first shop owner | Use Pocket for customers and debts, then find account help or sign out | Pocket phone/desktop navigation and visible account actions checked. Native device login, ledger writes and receipt uploads remain blocked by configuration/schema. |
| Growing business owner | Understand Pocket versus Main and preserve records when upgrading | Product comparison and product-specific plan labels checked. The existing owner-only upgrade/reconciliation transaction needs real staging data; no successful migration is claimed. |

## Files changed and reasons

### Authentication and availability

- `src/lib/auth/tenant-access.ts`: distinguish failed owner, invitation, membership and role-setting queries from permission denial.
- `src/lib/auth/mobile-access.ts`: report membership/permission RPC outages as unavailable, not absent membership.
- `src/lib/auth/session.ts`: separate accepted credentials from unavailable workspace access; bound workspace requests; reject missing sessions and failed sign-out.
- `src/app/auth/callback/route.ts`: require actual recovery events before setting a short-lived recovery marker; keep recovery independent of workspace provisioning; surface callback failures.
- `src/app/login/page.tsx`: preserve callback error visibility instead of redirecting authenticated error cases into a loop.
- `src/app/page.tsx`: route backend failures to a dedicated unavailable page.
- `src/app/workspace-unavailable/page.tsx`: provide recovery/support paths without inventing workspace data.
- `src/proxy.ts`: refresh auth-entry cookies, preserve redirect query strings, fail closed on product-routing failures, allow shared Pocket navigation/feedback APIs.
- `src/components/layout/profile-guard.tsx`: do not send existing users to onboarding during a profile outage; exempt public acknowledgement and unavailable routes.
- `src/contexts/auth-context.tsx`: resolve workspace identity and permissions together, abort stale requests, expose availability and sign-out errors, guard null access state.
- `src/lib/billing/client.ts`: resolve staff business access via the shared membership RPC; stop presenting mock/free entitlements after live failures.
- `src/lib/billing/pocket-entitlements.ts`: distinguish unknown database errors from actual plan denial.
- `src/lib/workspace/context.ts`: use effective Main entitlements and Pocket's own commercial entitlement, not the wrong subscription label.
- `src/hooks/use-entitlements.ts`: withhold features while access is unknown or unavailable.

### Shared corporate design and navigation

- `shared/brand-tokens.json`: align documented typography with IBM Plex and standardize 8px controls/12px surfaces.
- `src/lib/brand/theme.ts`: expose shared radius tokens to web styling.
- `src/app/globals.css`: standardize cards, fields, buttons, navigation, page hierarchy and flatter Pocket surfaces.
- `src/app/layout.tsx`: stop preloading unused light font weights.
- `src/components/ui/section-card.tsx`: consistent card headers, dividers and content spacing.
- `src/components/pages/landing-page.tsx`: corporate entry layout, workflow explanation, Main/Pocket comparison CTA, responsive header; remove unsupported recovery-rate and zero-risk wording.
- `src/components/pages/auth/auth-shell.tsx`: shared responsive two-panel account layout, product explanation, help/legal navigation and accessible error/success alerts.
- `src/components/pages/auth/login-page.tsx`: shared-account explanation and resilient submit error handling.
- `src/components/shells/dashboard-shell.tsx`: grouped desktop navigation, active resource links, real plan/workspace labels and visible access/sign-out failures.
- `src/components/shells/mobile-shell.tsx`: lighter phone chrome, readable navigation and workspace access errors.
- `src/components/shells/workspace-access-notice.tsx`: reusable unavailable state with retry and support.
- `src/lib/workspace/presentation.ts`: display-only plan labels; never used for authorization.
- `src/components/pages/more-page.tsx`: responsive account hub; remove hardcoded Pro identity; expose sign-out errors.
- `src/components/notifications/notification-bell.tsx`: visible bell contrast and 44px interaction target on the new light headers.
- `src/components/pocket/pocket-shell.tsx`: corporate navigation, product-specific plan display, support/upgrade paths and sign-out status.
- `src/components/pocket/pocket-ui.tsx`: clearer page hierarchy using shared typography.
- `src/components/pocket/pocket-states.tsx`: reusable failure sections without nested main landmarks; support path.
- `src/components/pocket/pocket-account-actions.tsx` and `src/app/pocket/more/page.tsx`: expose account help and sign-out on phones as well as desktop.

### Operational error states

- `src/components/operations/global-search.tsx`: distinguish loading, no matches and failures; cancel stale queries; support Escape and named results.
- `src/components/pages/cases-page.tsx` and `src/components/pages/auth/login-page-shell.tsx`: use the shared icon-field spacing class so search/email text does not overlap its icon.
- `src/components/action-centre/action-centre-panel.tsx`: hide unverified zero summaries, permission explanations and stale rows during failed loads.
- `src/components/pages/add-case-page.tsx`, `src/components/pages/reports-page.tsx`, `src/components/pages/billing-page.tsx`: show entitlement/service failures instead of implying an upgrade or Free-plan state.
- `src/components/pages/payments/payment-access-settings-page.tsx`: remove non-persisted security switches; expose server-backed new-link expiry, accessible selection state, and prevent link creation before a changed visibility rule is saved.

### Verification assets

- `scripts/release/verify-workspace-connectivity.mjs`: repeatable metadata/zero-row live audit and mobile configuration comparison; never retrieves account records or runs migrations.
- `scripts/release/verify-public-routing.mjs`: loopback-only built-app checks for public entry, static assets, retired/development routes and unauthenticated API boundaries.
- `tests/unit/auth-session-runtime.test.ts`, `tests/unit/auth-callback-runtime.test.ts`, `tests/unit/workspace-context-runtime.test.ts`: offline runtime coverage of auth, recovery, plan and availability boundaries.
- `tests/component/workspace-access.test.tsx`, `tests/component/global-search.test.tsx`, `tests/component/profile-guard.test.tsx`: permission/error presentation, sign-out, search and onboarding regression checks.
- `tests/e2e/corporate-refresh.spec.ts`: phone/desktop presentation and runtime-error checks with screenshots; explicitly local fixtures.
- `tests/e2e/critical-journeys.spec.ts`, `tests/e2e/global-setup.ts`: updated public heading and valid development-account fixture; preserve navigation/journey expectations.

## Validation

- `npm run typecheck`: final post-spacing rerun passed.
- `npm run lint`: final post-spacing rerun passed with 49 warnings; no errors. Warnings remain in legacy modules and are not silently represented as a clean lint report.
- `npm run build`: passed after the final application spacing fixes. The optimized build uses local `.env.local` (`NEXT_PUBLIC_APP_ENV=development`, both mock flags off), so this is not verification of deployed production environment settings.
- `npm run test:contracts`: 376 passed.
- `npm run test:unit -- --pool=forks --maxWorkers=1`: final clean rerun, 65 files and 290 tests passed. Earlier attempts encountered worker timeouts/a Windows native-process crash; a test-hook cleanup mistake was also corrected. The final serial-fork run supersedes those unsuccessful attempts.
- `npm run test:secrets`: final rerun passed across 858 source files and repository history.
- `npm run typecheck` in `mobile`: passed.
- `npm run lint` in `mobile`: passed.
- `npm run test:e2e -- tests/e2e/corporate-refresh.spec.ts tests/e2e/critical-journeys.spec.ts`: all 12 test cases reported passing, including the five supported viewport sizes. The Windows test-server teardown did not produce a final runner summary before the session ended; this is not represented as a clean runner exit. Screenshots were reviewed and the case-search icon spacing was corrected. These tests use local fixtures, not live accounts.
- `node scripts/release/verify-public-routing.mjs`: 12/12 passed against the optimized build on loopback. Covers public login/assets, retired beta/development routes, protected APIs, recovery-link gating, callback error routing and preserved login query parameters. The root uses a streamed RSC redirect (HTTP 200); a separate headless Chromium navigation confirmed arrival at `/landing` and its correct heading. The initial smoke expectation incorrectly assumed every server-component redirect must return HTTP 307 and was corrected using the installed Next 16 redirect documentation.
- Post-smoke-script `npm run typecheck`, `npm run lint` and `npm run build`: all passed (lint retains 49 warnings, zero errors). No further application-source edits were needed for the smoke-test correction. The temporary loopback QA server was stopped and confirmed unreachable after verification.

Reviewed screenshots are retained under `output/verification`: `main-cases-desktop.png`, `login-desktop.png` and `pocket-more-phone.png`. They intentionally show development fixtures, not customer records.

## Remaining release requirements

1. A database owner must confirm remote migration history. Follow `docs/PRODUCTION_MIGRATION_RECOVERY_PLAN.md`; the previously reported 49-file gap is a rollout proposal, not remotely verified migration history in this audit.
2. Apply reviewed migrations to isolated staging after backup/restore rehearsal. Run the repository's SQL invariant suites and real two-business RLS isolation tests before production approval.
3. Supply a reachable staging/deployed web origin and configure mobile's API base URL to that service. Do not use localhost for a physical phone or invent a production domain.
4. Verify owner and staff accounts, confirmation email delivery, password recovery, refresh, sign-out and deep links with staging accounts. No claim is made that every existing account/password works.
5. Exercise Main case-to-payment and Pocket debt-to-payment/receipt flows against real staging data, including owner-only upgrade reconciliation and payment-provider test mode.
6. Verify receiving-account QR fallback, public capability routes, email/feedback delivery and staff/admin launch scope against the deployed environment. Static checks do not replace these tests.
7. Native export/device interaction and email/deep-link round trips remain unverified; shared configuration and TypeScript checks alone are insufficient.

No production deployment is claimed. Existing unrelated worktree changes were preserved.
