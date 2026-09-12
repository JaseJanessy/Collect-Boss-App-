# CollectBoss Pocket V1 final release gate

Decision date: 2026-08-22. Current decision: **FAIL — do not begin pilot or production rollout**.

This is an evidence register, not a readiness claim. A source-controlled implementation or contract test is not proof that a remote migration, real billing event, backup restore, device build, or production integration succeeded.

## Required end-to-end scenarios

| Scenario | Required environment | Current evidence | Gate |
| --- | --- | --- | --- |
| 1. New owner starts Pocket, creates customer/debt, records partial/full payment | Production-shaped staging + Stripe test | Repository contracts only | NOT RUN |
| 2. Receipt photo/PDF OCR review, edit, confirm, duplicate protection | Staging storage, scanner, OCR provider | Repository contracts only | NOT RUN |
| 3. Due/overdue reminder, push, WhatsApp handoff, contact change cancellation | Staging scheduler/push + physical device | Repository contracts only | NOT RUN |
| 4. Simple invoice draft/issue/PDF/share/convert/payment; 30+30 hard limit | Staging Stripe/storage + device | Repository contracts only | NOT RUN |
| 5. 100-debt and 100-OCR limits, read-only lifecycle, retry/idempotency | Production-shaped staging | Repository contracts only | NOT RUN |
| 6. Pocket-to-Solo active/settled/preserved/review cases; replay and forced rollback | Backed-up staging database + Stripe test | Migration proposal and contracts only | NOT RUN |
| 7. Cross-tenant/API/file negative tests including owner-only upgrade | Staging with two real tenants | Static RLS/API contracts only | NOT RUN |
| 8. Main product smoke after migration with case totals, timeline, export, billing | Staging migrated workspace | Repository contracts only | NOT RUN |

All eight scenarios must pass with timestamped evidence, build/deploy identifier, tester, environment, and issue links. “Mostly passed” is not acceptance.

## Technical gates

- Web: TypeScript, lint, unit, contract, integration, secret, performance, Playwright, and production build must pass from the release commit.
- Mobile: TypeScript/lint plus Expo Android and iOS exports must pass from the same shared contract revision, followed by physical-device Pocket smoke tests.
- Database: staging apply, reconciliation, forced partial-failure rollback, idempotent replay, and verified backup restore must pass.
- Security: tenant isolation, service-role boundary, owner-only billing, private file access, public-token routes, environment validation, dependency audit, and secret scan must pass.
- Operations: Stripe/OCR/scanner/email/push/WhatsApp handoff failure ownership, alerts, retry/runbook, and backup/restore owners must be named and exercised.
- Accessibility: keyboard-only, screen-reader, focus, reduced-motion, 200% zoom, narrow mobile, tablet, desktop, long text, offline/error, and contrast checks must pass on production-shaped UI.

## Known blockers at this decision

- Migration `20260919` has not been applied or rolled back on a controlled staging database.
- No verified staging backup/restore evidence was supplied.
- No real Stripe Pocket-to-Solo checkout/webhook/old-subscription cancellation evidence exists.
- The eight release scenarios have not been executed in production-shaped staging.
- Android/iOS bundles exported locally, but physical-device results must still be captured for the final commit.
- The production build fails closed because malware scanning is not configured.
- Web and mobile production dependency audits report unresolved high-severity advisories.
- The static release gate now requires explicit rollback guidance in every migration and distinguishes implemented High source remediation from pending staging evidence. Passing that source gate does not satisfy the staging security or rollback-rehearsal gates.

## Local command evidence captured on 2026-08-22

- PASS — `npm.cmd run typecheck`.
- PASS with 54 pre-existing warnings — `npm.cmd run lint` (zero errors).
- PASS — `npm.cmd run test:contracts`: 375/375.
- PASS — `npm.cmd run test:unit`: 232/232.
- PASS — `npm.cmd run test:integration`: 28/28.
- PASS — `npm.cmd run test:secrets`: 819 source/history files scanned.
- PASS on isolated rerun — `npm.cmd run test:performance`: 4/4; the first CPU-contended parallel run missed the 25k-case ceiling by 107 ms and is retained as a warning.
- PASS — Playwright against the explicitly started local server: 23/23. The first in-process-server attempts exposed a generated-cache/startup shutdown issue; the clean external-server run exited successfully.
- PASS — mobile `npm.cmd run typecheck`, `npm.cmd run lint`, and `npm.cmd run export -- --output-dir ..\release\pocket10-expo`; web, Android, and iOS bundles were produced.
- PASS only with explicit local-development/mock configuration — `npm.cmd run build`; all 84 static pages generated and Prompt 10 routes were present.
- FAIL — production/default `npm.cmd run build`: mandatory malware scanner configuration is missing.
- FAIL — web `npm.cmd audit --omit=dev --audit-level=high`: 21 advisories (17 high, 4 moderate).
- FAIL — mobile equivalent audit: 78 advisories (61 high, 17 moderate).
- PASS — `npm.cmd run release:check`: every migration records rollback guidance and every High finding records its source-remediation/verification state. This is static evidence only; staging security verification and rollback rehearsal remain NOT RUN.
- NOT RUN — formatting: no repository formatting command is configured.
- NOT RUN — remote/staging migration apply, rollback rehearsal, backup restore, real Stripe billing events, real OCR/scanner/push integrations, and physical-device tests; no controlled environment or credentials were supplied.

## Acceptance and freeze rule

The release owner may change FAIL to PASS only when every scenario and technical gate has attached evidence and no unresolved severity-1 or severity-2 issue remains. CONDITIONAL is allowed only for a dated, owner-assigned non-security/non-financial limitation that cannot cause data loss, tenant exposure, billing error, balance error, or a broken primary journey.

Development is now scope-frozen for Pocket V1. Until the gate passes, only release blockers, security fixes, financial-correctness fixes, accessibility defects, and evidence/runbook work are allowed. Do not add major modules, broaden Main scope, or describe Pocket/Solo migration as production-ready.
