# Transaction Evidence Module Release Gate

Date: 2026-08-12  
Scope: Integrated Prompts 8-15 only  
Recommendation: **NOT READY for staging sign-off, limited pilot, or production**

The local implementation is substantially hardened. Prompt 15-focused type, contract, unit, mobile, secret-scan, and bundle-export checks pass. Final app-wide lint/test reruns also expose unrelated failures from concurrently added accounting, debt-truth, and payment-operations work; those files were not altered here. Release remains blocked because live database/RLS/storage isolation, real malware/OCR providers, the three end-to-end intake channels, backup/restore, clean-checkout reproducibility, and Android emulator/device verification were not available. The current dependency audit also reports unresolved high-severity advisories, including `sharp`/libvips in the server-side untrusted-image path.

## Architecture findings and hardening

- Originals use private tenant/intake/evidence storage paths, immutable evidence versions, short 60-second signed URLs, magic-byte checks, byte/page/dimension limits, and server-resolved tenant access.
- A prior release blocker left new evidence indefinitely at `scan_status=pending`. Prompt 15 adds a leased scanner queue, SHA-256 revalidation, clean/quarantine outcomes, bounded concurrency, timeout, three automatic attempts with backoff, terminal failure, and an owner/manager operational requeue RPC.
- Staging and production now fail at build/startup and upload time unless the HTTPS scanner provider, explicit third-party transmission opt-in, version, and server-only credential are configured.
- Exact evidence SHA matches and exact reference/amount/currency matches are blocked by a database trigger on outcome insertion. The mobile client also removes the “continue separately” action for exact matches. Probable/near matches remain review-only.
- Final posting remains one database transaction. The outcome guard checks the confirmed financial-movement flag and transaction-nature/route agreement before the transaction can commit.
- Review audit writes are redacted on insertion to identifiers, actor/time, correction count, and citation count. New manual corrections retain the old candidate, new value, and a required reason when an extracted candidate existed.
- Per-IP, per-process limits now distinguish draft creation, uploads, extraction, preview URL generation, general writes, and final submit. Extraction and final submit also have database-side tenant limits. A distributed gateway/rate-limit store is still required for horizontally scaled enforcement.
- The module health RPC reports 24-hour upload/scan/extraction outcomes, extraction latency, correction count, duplicate warnings, final-submit failures, stuck jobs, and orphan cleanup failures without document/OCR payloads.
- Fresh migration ordering had Prompt 14 sorting before Prompt 13 while referencing `review_status`. Migration identity was not renamed because that could diverge an already-recorded migration history. Instead, Prompt 14 adds the single prerequisite column idempotently; Prompt 13 remains authoritative for constraints and review behavior.

## Prompt 8-14 acceptance matrix

Status is based on evidence actually executed in this workspace. Static/isolated tests do not substitute for live RLS or full E2E verification.

| Prompt | Acceptance criterion | Status | Evidence / limitation |
|---|---|---:|---|
| 8 | Additive drafts, lifecycle events, and retry-safe idempotency | PASS | Contract and unit suites passed. |
| 8 | Immutable originals, derivatives, replacements, and private paths | PASS | Contract/unit checks passed; live storage policy is separately blocked below. |
| 8 | Tenant isolation and exact duplicate warnings | BLOCKED | SQL/static contracts pass; no controlled multi-business Supabase backend. |
| 8 | Viewer rejection and configurable manager submission | BLOCKED | Permission contracts pass; live role/RLS matrix not executed. |
| 8 | Compensating storage cleanup and orphan reporting | PASS | Contract checks and health query passed statically. |
| 8 | Atomic RPC writes and stable client errors | BLOCKED | Static/route tests pass; transaction rollback was not executed on Postgres. |
| 9 | Server PDF magic/MIME/size/page/encryption validation | PASS | Unit and contract suites passed. |
| 9 | Bearer requests resolve tenant permissions server-side | BLOCKED | Code contract passes; live auth backend unavailable. |
| 9 | Idempotent upload, tenant duplicate check, versioned replacement | BLOCKED | Contracts pass; staging API/storage integration not run. |
| 9 | Remove/cancel retains originals and audits | BLOCKED | Contract passes; live storage/database verification not run. |
| 9 | Mobile upload progress, retry, resume, preview, guarded continue | PASS | Component/static and mobile bundle checks passed; device E2E not run. |
| 10 | Screenshot and receipt image type/dimension/magic validation | PASS | Shared validation/unit tests and mobile bundle passed. |
| 10 | Camera/gallery permission, blur/quality, retake, safe preview flow | NOT TESTED | No Android emulator or physical device was available. |
| 10 | Original/derived image separation and immutable versioning | BLOCKED | Static contracts pass; live object-store behavior not executed. |
| 11 | Native PDF text before OCR; bounded OCR fallback | PASS | Extraction pipeline unit tests passed. |
| 11 | Explicit provider transmission, timeout, retry, and provenance | PASS | Unit/static tests passed with fake providers. |
| 11 | Atomic, leased, scan-gated, tenant-scoped extraction jobs | BLOCKED | Static SQL passes; no controlled Postgres/provider integration. |
| 11 | Protected raw result and stable client errors | PASS | Contract tests passed. |
| 11 | Extraction never writes financial records | PASS | Contract tests passed. |
| 12 | Candidate provenance and separation from approved records | PASS | Contract/unit tests passed. |
| 12 | Immutable versioned re-extraction | BLOCKED | Static checks pass; database execution not available. |
| 12 | Tenant-scoped masked candidate access | BLOCKED | Route/static checks pass; live roles not executed. |
| 12 | Locale-aware money/date/identifier validation and reconciliation | PASS | Parser unit tests passed. |
| 13 | Draft cannot silently become ready; current confirmation required | BLOCKED | Static and unit checks pass; live transaction not executed. |
| 13 | Server resolves tenant, currency, candidate, actor, and evidence | BLOCKED | Route/static checks pass; staging backend unavailable. |
| 13 | Amount ranking excludes balance, fee, limit, and total debit | PASS | Unit tests passed. |
| 13 | Corrections preserve actor/time/old/new/reason/citation | PASS | Unit/contract checks passed; new logs are redacted. |
| 13 | Accessible results-first mobile review | PASS | Component/static, lint, type-check, and Expo export passed. |
| 13 | Review does not create official financial/identity records | PASS | Contract checks passed. |
| 14 | Versioned resumable draft and immutable evidence links | BLOCKED | Unit/static checks pass; live database not run. |
| 14 | Atomic, tenant-scoped, idempotent submission | BLOCKED | SQL/contract checks pass; concurrent database execution not run. |
| 14 | Authoritative ledger, linked refunds, no direct balance overwrite | PASS | Financial and workflow unit/contracts passed. |
| 14 | Loan does not auto-create case; collection case is explicitly gated | PASS | Workflow unit/contracts passed. |
| 14 | Similar names never confirm identity; duplicates remain review-only | PASS | Workflow tests passed; exact duplicates now hard-block posting. |
| 14 | Explicit mobile outcomes and Save Draft at each stage | PASS | Static/component and Expo export passed. |

## Critical E2E scenarios 103-117

| ID | Scenario | Status | Evidence gap |
|---:|---|---:|---|
| 103 | Text PDF through extraction, confirmation, downstream record | NOT TESTED | Pipeline unit passed; no staging record creation. |
| 104 | Scanned PDF OCR fallback through confirmation | NOT TESTED | Fake-provider unit passed; no real OCR E2E. |
| 105 | Screenshot with amount/fee/balance/limit | NOT TESTED | Ranking unit passed; no device E2E. |
| 106 | Blurred bank-in photo, retake, successful extraction | NOT TESTED | No physical camera/device. |
| 107 | Low-confidence classification corrected by user | NOT TESTED | Review unit passed; no channel E2E. |
| 108 | Misclassified repayment corrected and correctly routed | NOT TESTED | Database route guard is static only. |
| 109 | Existing debtor selected from possible matches | NOT TESTED | Matching unit passed; no staging E2E. |
| 110 | Similar names do not auto-merge | NOT TESTED | Unit contract passed; no staging E2E. |
| 111 | Exact file/reference warns and does not double-post | NOT TESTED | App and DB guards exist; no concurrent Postgres test. |
| 112 | Network loss during upload/final submit | NOT TESTED | Idempotency contracts pass; network fault injection not run. |
| 113 | Session expiry and safe reauthentication | NOT TESTED | No live auth/device E2E. |
| 114 | Viewer write rejected | BLOCKED | Controlled role/backend unavailable. |
| 115 | Business A cannot access Business B intake/file | BLOCKED | Controlled two-tenant backend unavailable. |
| 116 | Different currencies are not invalidly aggregated | NOT TESTED | Unit financial checks pass; E2E not run. |
| 117 | Partial repayment derives authoritative outstanding balance | NOT TESTED | Ledger unit passed; module E2E not run. |

## Security and operations matrix

| Gate | Status | Result |
|---|---:|---|
| Magic bytes, MIME/extension mismatch, bounded sizes/pages/dimensions | PASS | Unit/contracts passed. |
| Malware hook, quarantine, retry, hash verification | PASS | Unit/contracts passed with fake scanner. |
| Real scanner provider and malicious fixture | BLOCKED | No provider endpoint/credential or controlled malicious-file environment. |
| Route and database rate limits | PASS | Static contracts passed; process-local web limiter limitation documented. |
| 60-second signed URL and private no-cache responses | PASS | Static/route contract. |
| No service/OCR/scanner secret in bundles | PASS | Secret scan: 638 source files. |
| Sensitive review/OCR payload excluded from new logs/metrics | PASS | Redaction/health contracts passed. Existing historical append-only events are not rewritten. |
| Multi-business RLS and storage policy execution | BLOCKED | Supabase CLI/backend unavailable. |
| Database backup and restore | NOT TESTED | No controlled database/backup target. |
| Mobile/server external error monitor | NOT TESTED | No monitoring provider configured; health endpoint is polling only. |
| Dependency audit | FAIL | Web: 21 vulnerabilities (17 high, 4 moderate). Mobile: 78 (60 high, 18 moderate). |
| Production environment build | BLOCKED | Correctly failed closed without real Supabase/scanner configuration. |
| Local optimized Next build | PASS | Passed with explicit development-only mock flag. |
| Mobile all-platform Expo export | PASS | Web/iOS/Android bundles emitted. |
| Android emulator and physical device | NOT TESTED | Devices unavailable. |
| Clean checkout/lockfile install | NOT TESTED | Workspace had extensive pre-existing/unrelated changes. |
| Existing browser regression assertions | PASS | All 8 assertions passed; runner later timed out during web-server teardown. |
| Three transaction intake channel E2E journeys | NOT TESTED | Existing browser suite does not exercise these mobile/staging flows. |

## Operations

### Scan retry and reprocess

1. `/api/cron/document-scans` runs every minute and claims at most three jobs per invocation.
2. Transient download/provider/timeouts retry automatically up to three attempts with exponential-minute backoff.
3. Scope, size, or SHA mismatch is terminal and must be investigated; do not requeue altered evidence.
4. After a transient terminal failure and provider recovery, an owner/manager-authorised service operation may call `document_evidence_requeue_scan(business_id,evidence_id,actor_id,REASON_CODE,correlation_id)`. Quarantined files cannot be requeued; replace the evidence after investigation.
5. Query `/api/cron/document-intake-health` with `CRON_SECRET` to monitor stuck scans/extractions and orphan-cleanup failures. Alerting must be connected before staging sign-off.

### Retention and deletion

The existing intake RPC assigns `retention_until = current_date + 7 years`. This inherited value has not been validated against an approved product/legal retention policy in this prompt. Originals must not be deleted merely for application rollback. Before enabling production traffic:

1. Approve the retention schedule and legal-hold behavior.
2. Implement a reviewed purge job that first proves expiry/no hold, deletes tenant-scoped private objects, then tombstones metadata with an audit record.
3. Monitor and manually reconcile `document_evidence.cleanup_failed` records.
4. Test backup restore before any purge is enabled.

### Migration and rollback

Apply `20260906_transaction_evidence_release_hardening.sql` only after all Prompt 8-14 migrations in a controlled staging database. Stop scan/extraction cron invocations during migration. Verify function privileges, trigger creation, queue indexes, existing counts, and a two-tenant RLS/storage matrix before resuming.

Rollback is intentionally non-destructive: stop the two document crons; deploy code that does not call the new RPCs; drop the release guard/redaction triggers and the five Prompt 15 service RPCs; optionally drop the queue index. Retain scan verdicts, attempts, outcomes, audit records, and added columns. Do not delete originals or historical security evidence as part of code rollback.

## API and UI changes

- Added authenticated cron endpoints: `GET|POST /api/cron/document-scans` and `GET /api/cron/document-intake-health`.
- Document intake operations now receive route-specific 429 limits; final submit can return `EXACT_DUPLICATE_BLOCKED`, `TRANSACTION_NATURE_MISMATCH`, `FINANCIAL_CONFIRMATION_MISMATCH`, or `FINAL_SUBMIT_RATE_LIMITED`.
- Upload returns 503 `MALWARE_SCANNER_NOT_CONFIGURED` outside development when scanning is unavailable.
- Mobile exact-duplicate review is blocking; probable/near duplicates can still be acknowledged as separate after review.
- Mobile manual edits to extracted reference/bank/sender/recipient fields expose a correction-reason input.

## Files changed for Prompt 15

Created:

- `supabase/migrations/20260906_transaction_evidence_release_hardening.sql`
- `src/lib/document-intake/scanning/provider.ts`
- `src/lib/document-intake/scanning/worker.ts`
- `src/app/api/cron/document-scans/route.ts`
- `src/app/api/cron/document-intake-health/route.ts`
- `tests/unit/document-malware-scanning.test.ts`
- `tests/transaction-evidence-release-gate.test.ts`
- `docs/TRANSACTION_EVIDENCE_RELEASE_GATE.md`

Modified:

- `.env.local.example`, `.gitignore`, `vercel.json`, `next.config.ts`
- `src/proxy.ts`
- `src/lib/document-intake/api.ts`, `server.ts`, `review.ts`
- `src/app/api/document-intakes/[intakeId]/workflow/route.ts`
- `mobile/src/components/transaction-review.tsx`, `transaction-routing.tsx`
- `src/lib/supabase/types.ts`, `src/lib/supabase/rls.sql`, `supabase/schema.sql`
- `supabase/migrations/20260904_profile_matching_draft_to_case.sql` (idempotent migration-order prerequisite only)
- `tests/unit/document-review.test.ts`
- Removed generated `debug.log` and added it to ignore rules.

## Commands and actual results

- `npm.cmd run typecheck` — PASS.
- `mobile: npm.cmd run typecheck` — PASS.
- Initial `npm.cmd test` — PASS: 279 contract tests and 154 Vitest tests before unrelated concurrent edits landed.
- Final module-focused contracts — PASS: 35 tests across Prompts 8-15.
- Final module-focused unit suite — PASS: 36 tests across 8 files.
- Final full `npm.cmd test` rerun — FAIL outside this module: 292/293 contract tests passed; the concurrently changed accounting adapter no longer satisfies its pre-existing `writeBack: false` contract, so the Vitest phase did not start.
- Initial `npm.cmd run test:integration` — PASS: 14 tests. Final rerun — FAIL outside this module because a concurrently added `payment-operations-api.integration.test.ts` contains no test suite; the existing 14 tests still passed.
- Focused malware/review tests — PASS: 12 tests.
- Focused release-gate contracts — PASS: 7 tests.
- Initial `npm.cmd run lint` — PASS with 55 warnings, 0 errors. Final rerun — FAIL outside this module with 1 error in concurrently added `src/hooks/use-debt-truth.ts` plus 54 warnings.
- `mobile: npm.cmd run lint` — PASS, 0 errors.
- Final `npm.cmd run test:secrets` — PASS: 652 source files.
- `npm.cmd run build` with no deployment configuration — BLOCKED as designed by strict Supabase environment validation.
- `NEXT_PUBLIC_APP_ENV=development; NEXT_PUBLIC_ENABLE_MOCK_DATA=true; npm.cmd run build` — PASS: optimized Next 16.2.7 build, 82 static pages.
- `mobile: npm.cmd run export` — PASS: web, iOS, and Android bundles.
- `npm.cmd run test:e2e -- tests/e2e/critical-journeys.spec.ts` — all 8 assertions PASS; command timed out after 300 seconds during server teardown and was cleaned up.
- `npm.cmd audit --omit=dev` — FAIL: 21 vulnerabilities (17 high, 4 moderate).
- `mobile: npm.cmd audit --omit=dev` — FAIL: 78 vulnerabilities (60 high, 18 moderate).
- Supabase CLI/Postgres migration execution — BLOCKED: CLI/database not installed or configured.

## Remaining defects, ranked

1. **P0 — Direct untrusted-image dependency risk:** web audit reports high-severity `sharp`/libvips advisories with no fix currently offered. This code path processes uploaded evidence. Do not enable production image intake until mitigated or risk-accepted with compensating isolation.
2. **P0 — Isolation and migration unverified:** multi-tenant RLS/storage, transaction rollback, migration apply, and backup/restore have not run against controlled Supabase.
3. **P0 — Required E2E absent:** PDF, screenshot, and bank-in receipt journeys 103-117 have not passed against real services/devices.
4. **P1 — Real scanner/OCR absent:** fake-provider tests pass, but provider behavior, malicious fixtures, timeouts, and data-processing terms are unverified.
5. **P1 — Dependency audits fail:** additional web/mobile high and moderate transitive advisories require compatible framework/vendor updates and retesting; broad `npm audit fix` was not applied blindly.
6. **P1 — Retention/purge governance incomplete:** inherited seven-year retention is not policy-approved here and no reviewed expiry purge/restore exercise exists.
7. **P1 — No external error monitoring:** health polling exists, but alert routing and mobile/server crash/error ingestion are not configured.
8. **P2 — Distributed limits:** proxy rate limits are per process; database limits protect extraction/final submit, but uploads/previews need a shared edge limiter at scale.
9. **P2 — Reproducibility/device evidence missing:** clean-checkout install, Android emulator, and physical-device validation were not possible in the dirty shared workspace.
10. **P3 — Test runner teardown:** all 8 existing browser assertions passed, but the command did not exit before timeout after a Next development-server router error.

## Release note and handoff

Release note: “Hardened transaction evidence intake with fail-closed malware scanning, leased retries/requeue, exact-duplicate posting prevention, route-specific throttling, redacted correction telemetry, operational health reporting, and stronger manual-correction provenance.”

Next prompt handoff: do not classify this module as production-ready. First resolve or isolate the `sharp` upload risk, apply all migrations to controlled staging, run the full two-tenant RLS/storage and backup/restore matrix, configure real scanner/OCR and monitoring providers, and execute scenarios 103-117 on web plus an Android emulator and real device.
