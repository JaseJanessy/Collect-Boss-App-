# Payment operations release and rollback

## Release order

1. Back up the production database and record the current migration version.
2. Apply `supabase/migrations/20260908_complex_payment_operations.sql` after the Prompt 16 payment-matching migration.
3. Deploy the application and confirm the cron secret and existing Supabase environment validation pass.
4. Configure each enabled accounting connection's payment-writeback cash account through the privileged writeback settings endpoint. Never store credentials in that metadata.
5. Verify receipt recording, split allocation, reversal, refund, approval, reconciliation, and outbox retry in staging before enabling staff access.

The migration backfills existing approved payment-match allocations. The bridge trigger then mirrors future approved matches into the immutable payment-operation ledger without duplicating the existing case payment event.

## Operational checks

- Confirm every `payment_ledger_journals` row has entries whose signed `amount_minor` totals zero.
- Compare imported, allocated, unallocated, refunded, and accounting-difference totals through `GET /api/payment-operations/reconciliation`.
- Monitor `accounting_payment_operation_outbox` for `failed` or `configuration_required` rows and use the retry endpoint after correcting configuration.
- Treat pending `payment_allocation_approval_requests` as unapplied proposals; no allocation or case balance changes before approval.

## Rollback

This release records financial history and should not be rolled back by deleting or rewriting ledger rows.

1. Disable payment-operation write endpoints and stop the accounting-sync cron.
2. Revert the application deployment to the prior version.
3. Leave the new tables and bridge column in place so recorded receipts, allocations, reversals, refunds, approvals, and outbox attempts remain auditable.
4. If the schema surface must be retired, revoke application grants and drop only the new triggers, functions, policies, and view after exporting all new tables. Do not drop the tables or `payment_match_allocations.payment_operation_allocation_id` until finance has reconciled and archived the history.
5. Restore from the pre-release backup only for a full incident recovery, never as a way to conceal or edit completed financial activity.

The migration is additive. Its final SQL comments identify the new objects and state the same history-preserving rollback constraint.
