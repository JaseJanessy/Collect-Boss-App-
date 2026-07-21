# Prompt 49 staging 69-case matrix

This is the canonical Prompt 49 checklist. A case is **NOT RUN** until isolated staging evidence is recorded; local mock tests do not change these statuses.

| ID | Category | Staging case | Status | Evidence / defect ID |
| --- | --- | --- | --- | --- |
| STG-01 | Configuration | Verify the target project is explicitly staging, not production. | NOT RUN | — |
| STG-02 | Configuration | Confirm a current staging backup/snapshot and restore owner. | NOT RUN | — |
| STG-03 | Configuration | Verify staging env values exist without exposing values. | NOT RUN | — |
| STG-04 | Configuration | Verify mock mode is rejected with `NEXT_PUBLIC_APP_ENV=staging`. | NOT RUN | — |
| STG-05 | Configuration | Verify the staging app URL is HTTPS and canonical. | NOT RUN | — |
| STG-06 | Configuration | Verify Stripe configuration is test mode only. | NOT RUN | — |
| STG-07 | Configuration | Verify staging webhook endpoint and test signing secret configuration. | NOT RUN | — |
| STG-08 | Configuration | Verify migration history, RLS, and private bucket inventory before changes. | NOT RUN | — |
| STG-09 | Auth | Create synthetic owner A and verify email confirmation/login. | NOT RUN | — |
| STG-10 | Auth | Create synthetic owner B and verify email confirmation/login. | NOT RUN | — |
| STG-11 | Auth | Reject duplicate sign-up and invalid credentials without disclosure. | NOT RUN | — |
| STG-12 | Auth | Complete password-reset request, reset, and new-password login. | NOT RUN | — |
| STG-13 | Onboarding | Complete owner A business profile and primary receiving account. | NOT RUN | — |
| STG-14 | Onboarding | Complete owner B profile and confirm separate business identity. | NOT RUN | — |
| STG-15 | Auth | Verify unauthenticated protected routes redirect to login. | NOT RUN | — |
| STG-16 | Auth | Sign out and verify session cannot access protected data. | NOT RUN | — |
| STG-17 | Tenant/RLS | Owner A cannot read owner B business or case rows. | NOT RUN | — |
| STG-18 | Tenant/RLS | Owner A cannot mutate owner B case, debtor, plan, or payment. | NOT RUN | — |
| STG-19 | Tenant/RLS | Owner A cannot read owner B evidence or payment-proof metadata. | NOT RUN | — |
| STG-20 | Tenant/RLS | Owner B cannot use owner A signed object URL after expiry or replacement. | NOT RUN | — |
| STG-21 | Storage | `evidence-files` is private and rejects direct unauthenticated access. | NOT RUN | — |
| STG-22 | Storage | `payment-proofs` is private and rejects direct client writes. | NOT RUN | — |
| STG-23 | Storage | Authorized owner uploads, reads by signed URL, and deletes evidence. | NOT RUN | — |
| STG-24 | Storage | Reject unsupported, tampered, and over-limit uploads. | NOT RUN | — |
| STG-25 | Token | Reject invalid, expired, revoked, used, and wrong-purpose public tokens. | NOT RUN | — |
| STG-26 | Token | Rotate/revoke a valid public token and verify prior token no longer works. | NOT RUN | — |
| STG-27 | Debtors/Cases | Create debtor and case for owner A; reload persistence. | NOT RUN | — |
| STG-28 | Debtors/Cases | Validate required fields, money precision, and invalid dates. | NOT RUN | — |
| STG-29 | Debtors/Cases | Edit and archive a debtor without affecting owner B. | NOT RUN | — |
| STG-30 | Debtors/Cases | Update allowed case lifecycle states and reject invalid transitions. | NOT RUN | — |
| STG-31 | Debtors/Cases | Verify case dashboard and ageing totals use owner-scoped data. | NOT RUN | — |
| STG-32 | Debtors/Cases | Verify account primary-selection and payment-lock updates. | NOT RUN | — |
| STG-33 | Debtors/Cases | Record an approved internal payment and verify balance exactly once. | NOT RUN | — |
| STG-34 | Debtors/Cases | Reverse or reject a payment without corrupting outstanding balance. | NOT RUN | — |
| STG-35 | Evidence/Reminders | Upload PDF evidence, open authorized signed URL, then delete it. | NOT RUN | — |
| STG-36 | Evidence/Reminders | Verify evidence filename/type/size validation and audit evidence. | NOT RUN | — |
| STG-37 | Evidence/Reminders | Generate, copy, save, and mark a reminder sent. | NOT RUN | — |
| STG-38 | Evidence/Reminders | Verify reminder history is tenant-scoped and chronological. | NOT RUN | — |
| STG-39 | Evidence/Reminders | Generate an evidence pack from selected authorized evidence. | NOT RUN | — |
| STG-40 | Evidence/Reminders | Verify generated pack excludes unselected and foreign-tenant files. | NOT RUN | — |
| STG-41 | Evidence/Reminders | Verify demand draft uses immutable case snapshot fields. | NOT RUN | — |
| STG-42 | Evidence/Reminders | Verify evidence/reminder failure states expose no storage paths or secrets. | NOT RUN | — |
| STG-43 | Debtor Payment | Immediate lock: valid debtor token sees only intended payment details. | NOT RUN | — |
| STG-44 | Debtor Payment | Approval lock: request, owner approval, expiry, and disclosure behavior. | NOT RUN | — |
| STG-45 | Debtor Payment | Manual lock: payment details are never disclosed by the public flow. | NOT RUN | — |
| STG-46 | Debtor Payment | Debtor submits allowed payment proof; owner sees pending review. | NOT RUN | — |
| STG-47 | Debtor Payment | Owner approves proof once; balance and audit trail update once. | NOT RUN | — |
| STG-48 | Debtor Payment | Owner rejects proof; balance remains unchanged and feedback is safe. | NOT RUN | — |
| STG-49 | Payment Plan | Create valid weekly, monthly, and custom payment-plan schedules. | NOT RUN | — |
| STG-50 | Payment Plan | Reject invalid installments, rounding, and non-increasing custom dates. | NOT RUN | — |
| STG-51 | Payment Plan | Debtor accepts an active plan through its correct capability token. | NOT RUN | — |
| STG-52 | Documents | Generate formal-demand PDF and confirm tenant/case snapshot accuracy. | NOT RUN | — |
| STG-53 | Documents | Generate small-claim pack and verify external legal-review warning. | NOT RUN | — |
| STG-54 | Documents | Create, update, and withdraw controlled lawyer referral. | NOT RUN | — |
| STG-55 | Reports | Reconcile dashboard, report, statement, and exported CSV totals. | NOT RUN | — |
| STG-56 | Reports | Verify CSV formula-injection protection and authorized exports only. | NOT RUN | — |
| STG-57 | Documents | Verify legal-document index and empty/error states are owner-scoped. | NOT RUN | — |
| STG-58 | Stripe Billing | Verify test checkout only accepts server-selected configured plan IDs. | NOT RUN | — |
| STG-59 | Stripe Billing | Complete Starter test checkout and verify subscription/entitlement state. | NOT RUN | — |
| STG-60 | Stripe Billing | Exercise customer portal return, cancellation, and downgrade state. | NOT RUN | — |
| STG-61 | Stripe Billing | Deliver failed-payment event and verify entitlement behavior. | NOT RUN | — |
| STG-62 | Stripe Webhook | Reject invalid signature before JSON processing. | NOT RUN | — |
| STG-63 | Stripe Webhook | Replay duplicate event and verify one `billing_events` claim. | NOT RUN | — |
| STG-64 | Stripe Webhook | Verify out-of-order/retry event handling and redacted observability. | NOT RUN | — |
| STG-65 | Browser/PWA | Verify desktop, phone portrait/landscape, and tablet layouts. | NOT RUN | — |
| STG-66 | Browser/PWA | Verify keyboard navigation, labels, error messages, and focus targets. | NOT RUN | — |
| STG-67 | Browser/PWA | Verify manifest, icons, HTTPS install, update, and offline private-route safety. | NOT RUN | — |
| STG-68 | Performance | Record staging LCP, INP, CLS, transfer size, and slow-route behavior. | NOT RUN | — |
| STG-69 | Regression/Cleanup | Run full automated regression and remove all synthetic staging data. | NOT RUN | — |

## Totals

| PASS | FAIL | BLOCKED | NOT RUN | Total |
| ---: | ---: | ---: | ---: | ---: |
| 0 | 0 | 0 | 69 | 69 |

Status changes require a timestamp, actor, environment URL/project identity, non-sensitive evidence location, and linked defect ID where applicable.
