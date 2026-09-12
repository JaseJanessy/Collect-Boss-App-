# Explainable balance and discrepancy detection

Prompt 19 adds deterministic, review-only checks across the canonical debt ledger, invoice obligations, normalized transactions, approved credit notes, payment proofs, accounting mappings, human-confirmed document amounts, and already-paid claims.

## Release checks

1. Apply `20260910_explainable_discrepancy_detection.sql` after the Prompt 18 migration.
2. Confirm authenticated `case.read` users can read findings but cannot write either finding table directly.
3. Confirm only `case.manage` users can run a scan or change a finding status.
4. Scan a staging case containing each labeled fixture condition and verify citations, conflicting values, confidence, severity, and impacted amount.
5. Confirm dismissal requires a reason, defer requires a future date, and resolution requires a corrective-workflow reference.
6. Change a dismissed finding's source value and verify it reopens with a history event.
7. Resolve the final active finding and verify both the case summary projection and Action Centre item close.
8. Verify no scan or transition sends a reminder, communication, demand, or legal-handoff request.

## Rollback

Disable the discrepancy API and any scheduled scan caller first. Revoke execute on `discrepancy_record_scan` and `discrepancy_transition`. For a history-preserving rollback, leave both new tables tenant-readable and stop all writes; remove the case card and queue filter from the application. For a destructive rollback only after export and confirmation that retention is not required, drop in this order: the two RPCs, `discrepancy_refresh_projection`, the append-only trigger/function, `discrepancy_finding_events`, `discrepancy_findings`, the two case projection columns, and the Prompt 19 replacement of `action_centre_queue`. No approved ledger, payment, invoice, accounting, or communication row requires restoration.

## Known limitations

- Cross-document contract/invoice comparison only uses human-confirmed amounts with a confidence score of at least 70%; it does not decide which document is authoritative.
- An already-paid claim is treated as matched only when an approved payment with the exact claimed amount exists. A reviewer must still verify identity and timing.
- Scans are user-triggered in the case Financials section. A scheduled scanner can call the same permission-checked workflow in a later release.
- The included route limiter is per process. Multi-instance deployment should use the existing shared database limiter before enabling scheduled or high-volume scans.

