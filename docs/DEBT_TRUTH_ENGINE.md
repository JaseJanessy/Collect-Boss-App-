# Debt Truth Engine

The Debt Truth Engine is the case-level source of truth for money. It uses integer minor units, one explicit ISO currency per case, approval-gated facts, immutable versions, and evidence citations. Generative AI output is never an authoritative balance input.

## Balance semantics

- Approved invoices are the charge base when present; otherwise the migrated original principal is the base. They are not added together.
- Confirmed outstanding is the approved charge base plus net approved adjustments and approved fees, less approved credit notes and confirmed payments, then less the amount currently classified as disputed.
- Open disputes are separately displayed and capped at the remaining exposure. They do not erase the underlying approved charge.
- Pending charge facts are unverified potential charges. Pending credits or payment claims are disclosed but cannot reduce confirmed debt.
- Total displayed exposure is confirmed outstanding plus disputed amount plus unverified potential charges.
- Corrections append a higher source version or an explicit reversal. No event or balance version is erased.

## Approval matrix

| Fact | Required authority |
| --- | --- |
| Principal, invoice, credit note | Approved source record or configured source approver |
| Payment | Approved payment workflow/payment approver |
| Fee or interest | Configured fee approver; never automatic |
| Settlement adjustment | Settlement approver |
| Write-off | `write_off.approve` authority |
| Manual adjustment | Adjustment approver who is not the requester |

All event types require at least one evidence/source citation. Tenant users receive read-only access under `case.read`; reconciliation exceptions require `audit.read`; mutation and recalculation RPCs remain service-role-only.

## Migration and reconciliation

Apply `20260909_debt_truth_engine.sql` after `20260908_complex_payment_operations.sql`. The migration creates cited opening events from legacy case principal and financial events, imports linked receivable obligations, calculates one deterministic version per case, and writes drift or source failures to `debt_ledger_reconciliation_exceptions`. Exceptions are reports; the migration does not silently repair or discard legacy data.

## Rollback

For a history-preserving rollback, stop debt-truth readers/workers, disable `debt_ledger_events_recalculate`, `case_financial_events_debt_truth_sync`, `obligations_debt_truth_sync`, `recovery_case_obligations_debt_truth_sync`, and `disputes_debt_truth_recalculate`, then revoke the three service RPC grants. Leave ledger events, versions, and exception rows read-only. The additive case projection columns may remain unused. Destructive removal is only safe after exports, downstream references, and retention obligations are cleared.
