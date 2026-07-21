# CollectBoss v1.0 scope and acceptance contract

**Version:** 1.0.0  
**Status:** approved scope baseline for Phase 2  
**Decision date:** 2026-07-16

This document defines what "complete" means for CollectBoss v1.0. It is a product and release contract, not evidence that the release is ready. Every item below still requires the stated acceptance evidence and final release gates.

## Non-negotiable money boundary

CollectBoss is not a payment custodian. A debtor pays the creditor directly by bank transfer (or a recorded offline method) and may submit proof. Stripe is used only to bill CollectBoss account subscriptions. No v1.0 flow may take, hold, split, or move debtor funds through Stripe or CollectBoss.

## Actors and authorization model

| Actor | v1.0 authority | Scope decision |
| --- | --- | --- |
| Account owner | One authenticated primary user controls one creditor account at launch. The account may represent an individual or a business. | In scope |
| Debtor | Public participant, not an application account. Access is limited to an opaque, purpose-specific, expiring and revocable link. | In scope |
| Staff/team member | No membership, invitation, delegated permission, or staff route/RLS model. | Deferred |
| Application administrator | No in-product administrator role. Supabase and Stripe operators remain external platform administrators. | Deferred / prohibited as a launch assumption |

Owner identity must come from the authenticated server session. Browser inputs cannot establish ownership, role, account, money movement, entitlement, or review authority. The existing `owner`, `system`, and `debtor` audit labels are not roles.

## Core v1.0 journeys

| Journey | Included outcome | Required acceptance evidence |
| --- | --- | --- |
| Register and onboard | An owner authenticates, creates one complete creditor profile, and configures a receiving identity. | Two isolated owner accounts pass profile and tenant-isolation staging checks. |
| Create and manage a case | Owner can create, edit, view, and close/mark paid only their own debtor cases. | Reload persistence, validation, and cross-tenant RLS tests pass. |
| Evidence and reminders | Owner can store private evidence, generate/copy/log reminders, and assemble case material. | Private bucket policy, signed access, invalid-file rejection, and reminder audit checks pass. |
| Bank-transfer proof | Debtor receives an opaque payment link, sees only required instructions, and submits a proof. | Token expiry/revocation, field minimisation, proof upload, and audit-log tests pass. |
| Proof reconciliation | Owner can see a public proof submission, approve/reject it exactly once, and approval creates or reconciles the authoritative payment record and updates the case balance exactly once. | End-to-end transactional/idempotency test passes; rejected and duplicate submissions do not alter balances. |
| Owner-recorded payment | Owner may record an offline payment with a reference/proof; approved records affect the case balance exactly once. | RLS and duplicate/approval-transition tests pass. |
| Payment plan acknowledgement | Owner creates a plan and gives the debtor a purpose-specific acknowledgement link. | Valid acknowledgement persists only required confirmation data; expired/revoked links fail safely. |
| Documents and reporting | Owner can generate clearly labelled draft documents/evidence packs and owner-scoped statements/reports. | Output uses live case data, is owner-scoped, and matches source records. |
| Subscription billing | Owner purchases/manages a CollectBoss subscription through Stripe; a verified webhook controls entitlements. | Checkout, webhook signature, duplicate-event, portal, and entitlement tests pass. |

## Core entities and status vocabulary

The following current vocabulary is the v1.0 baseline. A new state needs a documented transition, actor rule, database/service rule, and acceptance test.

| Entity | v1.0 state vocabulary |
| --- | --- |
| Case | `action_needed`, `payment_promise`, `partial_paid`, `paid`, `overdue`, `formal_demand_ready` |
| Payment access request | `pending`, `approved`, `rejected`, `expired`, `sent_manually` |
| Payment proof/payment review | `pending_review`, `approved`, `rejected`, `unmatched` |
| Reminder | `draft`, `pending`, `sent`, `failed`, `copied`, `sent_manually`, `follow_up_needed` |
| Payment plan | `active`, `completed`, `cancelled` |
| Legal document | `draft`, `finalised`, `sent`, `archived` |

`approved` is the only payment-review state that may reduce a case balance. A public submission is not itself a payment ledger record until the approved, idempotent reconciliation path has run.

## Scope decisions

### In scope

- Individual and business creditor accounts using a single primary owner model.
- Individual and business debtors represented on cases; debtors are not authenticated product users.
- Creditor receiving accounts and direct bank-transfer payment instructions.
- Proof submission, owner review, payment reconciliation, and auditability.
- Case management, evidence, reminders, payment plans, draft legal documents, reporting/statements, and subscription billing.
- PDPA-aware handling of owner, debtor, payment, evidence, and audit data.

### Deferred from v1.0

- Team/staff invitations, delegated access, roles, assignments, and staff checklists.
- In-product administrator controls.
- Lawyer marketplace/referral partner directory. Existing placeholder listings are not a live service and cannot be represented as one at launch.
- QR image upload and a separate `duitnow-qr` storage service.
- Gallery, booking, and general event-domain services.
- Automated reminder sending. v1.0 supports generation/copy/logging unless a separately approved delivery provider and consent model are added.

### Prohibited assumptions

- Stripe or CollectBoss custody of debtor money.
- A client-provided owner ID, business ID, role, payment status, balance, or entitlement being authoritative.
- Mock data in staging or production.
- Treating document templates as legal advice, representation, or a guarantee of recovery.
- Advertising placeholder lawyer partners, mock report trends, or incomplete acknowledgement OTP/signature UI as completed commercial services.

## Definition of done and release blockers

A v1.0 scope item is done only when it is implemented, connected to approved real staging/production services, tenant-safe, tested, documented, observable, and recoverable. Local rendering or a successful build is not sufficient.

The following are release blockers:

1. A debtor-proof approval path that does not atomically reconcile the payment ledger and case balance.
2. Missing or unverified RLS, private storage policies, migration ordering, or generated database-type coverage for a live workflow.
3. Any production/staging mock fallback or service credential exposure.
4. Cross-tenant access, public-token leakage, unsafe document/payment data, or an authorization decision made from browser input.
5. Unverified Stripe webhook signature, idempotency, or entitlement update.
6. Product copy that presents a deferred or placeholder feature as live.

Severity policy: critical and high findings block launch; medium findings need a recorded owner, mitigation, and acceptance date; low findings need backlog ownership. No exception changes the money, authorization, tenant, secret, or mock-data rules above.

## Required release evidence

- Complete the manual staging checks in `docs/APP_CONNECTION_MATRIX.md`, `docs/FINAL_DEPLOYMENT_CHECKLIST.md`, and billing QA documents with recorded results.
- Two owner accounts prove tenant isolation across cases, evidence, accounts, payments, plans, documents, and statements.
- Public payment and acknowledgement links are tested for valid, invalid, expired, revoked, replayed, and cross-case conditions.
- Evidence and payment-proof buckets are private and enforce approved policies; signed URLs and deletion behaviour are tested.
- Stripe test and production environment checks are completed separately, including webhook verification and duplicate-delivery handling.
- Legal copy is reviewed when data categories, payment behaviour, or availability claims change.

## Traceability and next decisions

This contract is grounded in the current 43 routes, owner-only RLS model, Supabase schema, public-token migration, and legal/PDPA pages. It deliberately does not approve a database shape for individual versus business profile data; that is the narrowly scoped design decision for Prompt 8. Any resulting SQL must be proposed and approved before application and must keep `supabase/schema.sql`, ordered migrations, `src/lib/supabase/rls.sql`, and generated database types consistent.

