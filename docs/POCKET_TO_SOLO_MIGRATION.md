# Pocket-to-Solo migration runbook

Status: implementation proposal, not yet applied to staging or production.

## Identity and source-of-truth model

The upgrade retains the existing authenticated owner, `businesses.id`, customers, accounts, and workspace. CollectBoss Solo is the customer-facing name for the existing internal `starter` plan slug. The migration does not create another tenant.

Pocket already stores its debts in the shared `obligations` ledger and its payments/reversals in shared `payment_allocations` and `payment_receipts`. The safe migration therefore creates only a Solo `cases` projection and a unique `recovery_case_obligations` link. It never copies a debt or payment amount. Existing receipt/OCR, reminder, audit, note, and invoice records remain under the same `business_id`.

| Pocket source state | Solo result | Financial handling |
| --- | --- | --- |
| Active, overdue, or partially paid | One linked Solo case | Reuse obligation balance and payment history |
| Settled/paid | One linked paid Solo case | Reuse settled obligation; no new payment |
| Draft, void/cancelled, written off, or archived | Preserved history only | No active Solo case |
| Disputed | Review queue; checkout blocked | No guessed case state |
| Malformed customer, currency, reference, due date, or balance | Review queue; checkout blocked | Source must be corrected |
| Already linked to a case | Review queue; checkout blocked | Prevent ambiguous or duplicate mapping |

The unique constraint on `recovery_case_obligations.obligation_id`, deterministic case ID, per-run item key, and one-active-run index enforce exactly-once projection. Main customer totals already exclude linked case projections, preventing double counting.

## Transaction and billing sequence

1. Owner preparation takes a workspace advisory lock, confirms Pocket/single-owner scope, snapshots all eligible source balances, and creates review items.
2. The server chooses the configured Solo price and attaches the Stripe Checkout session to the run. The client cannot send a plan, workspace ID, or price ID.
3. A verified Stripe event synchronizes the active/trialing Solo subscription.
4. The commit RPC locks the workspace and every ready obligation, validates all source snapshots before any case write, creates unique cases/links, reconciles integer minor-unit totals, cancels pending Pocket reminders, records audit provenance, and switches `workspace_product_states.product_type` last. Any exception rolls back the whole transaction.
5. After commit, Stripe cleanup cancels prior Pocket subscriptions. Failed cleanup is recorded and the provider event fails for operational retry. The completed migration itself is idempotent.

The source rows are retained after success. Solo case timelines and business exports project Pocket payments, reversals, receipt links, reminders, and simple-invoice records from their original tables.

## Review, failure, and rollback

Owners correct flagged source data through the existing ledger and choose **Refresh review**. A fresh preparation replaces the previous review snapshot while retaining the failed run for audit. Checkout cannot begin while review items remain.

Before first successful use, disable checkout/webhook wiring and drop the proposed functions/tables in reverse dependency order if the proposal is rejected. After any successful migration, do not delete cases, links, or provenance rows. Disable further upgrades, stop billing cleanup, collect reconciliation evidence, and use the verified database backup/restore incident procedure. A Solo-to-Pocket downgrade is explicitly unsupported.

## Staging rehearsal checklist

- Create a verified backup and record restore owner, location, timestamp, and checksum.
- Apply migrations through `20260919` to a production-shaped staging copy.
- Exercise active, settled, cancelled, disputed, malformed, already-linked, and 100-debt workspaces.
- Force an exception after the first case insert and prove the transaction exposes zero partial cases/links.
- Replay the same prepare, Checkout, subscription, and invoice events; prove one run/link/case and unchanged balances.
- Reconcile per-currency due, paid, and outstanding integer totals before/after.
- Verify retained PDFs/OCR evidence remain private and tenant-scoped.
- Rehearse the documented backup restore and record elapsed time/data-loss window.

No item above is marked complete by this repository-only implementation.
