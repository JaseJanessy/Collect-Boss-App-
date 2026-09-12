# Commercial V1 release validation

This is the production-like validation procedure for `v1.0.0-rc.1`. Local mock tests are supporting evidence only. Every staging step requires a timestamp, operator, deployment URL, backend project reference, result, and non-sensitive evidence link.

## Environment preflight

1. Confirm the target is an isolated staging deployment and database. Record identifiers without credentials.
2. Confirm mock mode is disabled, Stripe is in test mode, QuickBooks is sandboxed, and production credentials are absent.
3. Create a database backup and restore it into a new empty non-production database with `scripts/release/backup-restore.ps1`.
4. Apply the clean schema to one empty database. Separately restore the previous stable release and apply the ordered upgrade migrations.
5. Run `enterprise_security_invariants.sql` and `production_integration_invariants.sql` against both database paths.
6. Create two synthetic tenants, Owner A and Owner B, with distinct receiving accounts. Never use customer data.

## Critical end-to-end scenario

Run this as one traceable scenario. Do not reset data between steps unless the procedure explicitly says so.

| Step | Action | Required evidence |
| --- | --- | --- |
| E2E-01 | Sign up Owner A, confirm authentication, complete tenant profile, and create a receiving account. | Auth event, tenant ID, audit event IDs. |
| E2E-02 | Create a debtor, case, and invoice/obligation with integer minor-unit value and currency. | Case and obligation IDs; starting balance. |
| E2E-03 | Upload a synthetic PDF or image through document intake. | Intake/evidence IDs; private storage check. |
| E2E-04 | Run malware scan, native-text/OCR extraction, and human review. Confirm cited amount, date, reference, sender, and recipient. | Scan verdict, extraction version, citation references, reviewer audit ID. |
| E2E-05 | Promote the confirmed evidence into the case and regenerate debt truth. | Before/after balance versions and ledger references. |
| E2E-06 | Submit a partial dispute, review it, and prove only the approved outcome affects the financial projection. | Dispute events and unchanged/changed balance snapshots. |
| E2E-07 | Record a promise or payment plan, expose it only through the correct capability, and record the debtor response. | Expiring token metadata, response event, plan/promise state. |
| E2E-08 | Submit a synthetic payment proof through the public capability. | Submission and evidence IDs; no unrelated tenant data. |
| E2E-09 | Import or create the corresponding normalized payment transaction and run candidate matching. | Ranked explanations and candidate job ID. |
| E2E-10 | Approve the correct match once. Repeat the same request and prove the duplicate produces no second ledger result. | Idempotency key, allocation/payment event, duplicate response. |
| E2E-11 | Allocate the remaining settlement or approved payment, verify zero outstanding, and close with the correct reason. | Balanced ledger, debt version, closure audit event. |
| E2E-12 | Generate statement/report/evidence output and reconcile every total to the ledger. | Export hashes and source references. |
| E2E-13 | Review the audit chain from tenant setup through closure and verify continuity. | Audit IDs and hash-continuity result. |
| E2E-14 | Repeat tenant-sensitive reads as Owner B and prove no Owner A identifier, metadata, file, export, or count is disclosed. | Denied requests and RLS test output. |

## Mandatory negative scenarios

| ID | Scenario | Pass condition |
| --- | --- | --- |
| NEG-01 | Cross-tenant case, file, report, job, and guessed-ID access | Database and API deny without confirming record existence. |
| NEG-02 | Unauthorized approval by viewer, staff, or manager without configured authority | Permission denial; no ledger or audit outcome is forged. |
| NEG-03 | Duplicate payment transaction, proof approval, allocation, and Stripe webhook | One correct business result and a visible idempotent duplicate outcome. |
| NEG-04 | Validly signed Stripe webhook whose provider/state processing fails | Durable retry, redacted error, backoff, and safe replay. |
| NEG-05 | Accounting sync timeout and revoked refresh token | No partial corruption; retry or reconnect state is actionable. |
| NEG-06 | Expired, revoked, rotated, consumed, wrong-purpose, and malformed public tokens | Generic denial and no tenant inference. |
| NEG-07 | Malware scanner unavailable and confirmed malicious upload | Fail closed or quarantine; no OCR, preview, promotion, or download. |
| NEG-08 | Application rollback with forward-compatible database, followed by database restore rehearsal | Previous release operates or rollback stops safely; restored fingerprint matches backup. |

## Load and performance gates

- Run `npm run test:performance` as a deterministic local capacity screen.
- Seed the staging project with representative high-volume synthetic cases, documents, payments, and integration jobs. Record counts and seed revision.
- Run authenticated API/browser load from an approved runner outside production. Record p50, p95, p99, error rate, database CPU/connections, queue depth, and recovery time.
- Exercise at least: case list/search/report, document upload/scan/extraction queue, payment import/matching/review, and integration claim/retry/dead-letter processing.
- Set release thresholds before the run. A threshold may not be relaxed after seeing a failing result without a documented release-blocking review.

## Backup, clean migration, upgrade, and rollback evidence

- Backup/restore must be an actual `pg_dump`/`pg_restore` rehearsal into an empty non-production database. A dashboard screenshot alone is insufficient.
- Clean install means current `supabase/schema.sql`, then `supabase/billing.sql`, followed by invariant tests.
- Upgrade means the previous stable schema/data snapshot followed by every ordered migration newer than that release, then invariant tests.
- Rollback must use the reviewed rollback procedure for the affected migration group or a demonstrated database restore. Never improvise destructive SQL during an incident.
- Record dump SHA-256, source/restore host identifiers, row-count fingerprint, duration, operator, and result without recording database credentials.

## Release decision

Critical or High defects, failed restore, failed migration path, cross-tenant access, financial duplication, secret exposure, production mock fallback, or missing alert ownership block release. Medium issues require owner, mitigation, and target date. Low issues require backlog ownership.
