# CollectBoss Pocket commercial policy

This document is the reviewable contract for migration `20260913_pocket_entitlements_billing_usage.sql`. The migration is a proposal and must not be applied until its SQL, existing Pocket product-state migration, and production Stripe catalogue are approved together.

## Offers and limits

All amounts are integer minor units in MYR. Pocket Monthly is RM9.90/month and Pocket Annual is RM99/year; both grant the same base capabilities. A Pocket workspace has one active user and at most 100 active debts. An active debt is an unarchived obligation with a positive computed outstanding balance whose status is not `paid`, `void`, or `written_off`.

Receipt processing allows 100 unique source-file requests per provider billing cycle. The source SHA-256 is the usage identity, so controlled retries and duplicate uploads of the same bytes do not consume another unit.

The Simple Invoice add-on costs RM10/month and enables 30 committed invoice numbers per base-plan billing cycle. A non-recurring RM10 pack adds 30 units to that current cycle only, may be bought once per cycle, never auto-renews, and cannot raise the limit above 60. A draft consumes no unit until a number is committed. Cancelling or voiding a numbered invoice does not restore its unit; this prevents cancel-and-recreate quota bypass. The future invoice-create transaction must call `pocket_commit_invoice_usage` in the same transaction that commits its invoice number.

## Lifecycle and data preservation

- `trialing`, `active`, and `cancelled_at_period_end` permit entitled writes.
- `past_due` rejects writes with `SUBSCRIPTION_PAST_DUE`.
- Stripe `past_due` enters `payment_retry` with a seven-day retry window. After the deadline, the idempotent lifecycle job moves the workspace to `grace_read_only`.
- `cancelled` remains readable until the paid cycle ends, then becomes `grace_read_only`.
- `grace_read_only` and `suspended` stop writes. Read and export remain available in every state; no billing transition deletes customer, debt, receipt, payment, or invoice data.
- Removing the invoice add-on preserves existing invoice data and immediately prevents new invoice-number commits.

Provider events are signature-verified by the existing Stripe webhook. Event IDs are claimed once, and each subscription item stores its latest provider timestamp so an older delivery cannot overwrite newer item state. Provider price IDs live only in server environment configuration; client requests send an offer key, and the server resolves the configured price.

## Enforcement and rollback

The service API resolves the signed-in user and workspace. Clients cannot submit workspace IDs, price IDs, plan names, limits, usage counts, or add-on flags. Usage rows and counters are locked in one database transaction. Obligation, extraction, and active-membership triggers guard non-HTTP/background writes as well as route handlers.

For rollback, first disable Pocket checkouts, Pocket write routes, and Pocket webhook entitlement application. Export commercial and usage audit rows. Drop the three enforcement triggers, then the Prompt 3 functions and tables in reverse dependency order. Restore the prior application before removing schema objects. No customer data is deleted by this rollback sequence.

## Pocket-to-Solo upgrade policy

CollectBoss Solo is presented to customers as the next product tier and maps to the existing server-side `starter` plan slug. Only the Pocket workspace owner may start an upgrade. The owner keeps the same account and workspace identity; checkout cannot accept a client-provided plan or price identifier.

The migration creates one Solo case projection for each eligible Pocket obligation and links it through `recovery_case_obligations`. It does not copy obligations, payment allocations, reversals, receipts, OCR evidence, reminder history, or invoice records. Settled debts become paid cases. Cancelled, draft, written-off, and archived debts remain retained history without becoming active cases. Disputed, malformed, or already-linked debts enter a review queue and block checkout until the source record is corrected and preparation is refreshed.

The Solo subscription is applied before the database commit. The commit locks the workspace, validates every prepared balance snapshot, creates and reconciles all case projections in one transaction, records an audit event, and switches product ownership last. Only after that commit does the webhook cancel old Pocket subscriptions. Cleanup failure is persisted and causes the Stripe event to retry; it does not undo or duplicate the financial migration.

Solo-to-Pocket downgrade is not supported in this release. Support must not simulate a downgrade by deleting cases, unlinking obligations, changing plan rows manually, or copying financial history.
