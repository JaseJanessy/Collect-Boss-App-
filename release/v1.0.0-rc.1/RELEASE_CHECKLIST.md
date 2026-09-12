# Commercial V1 release checklist

Candidate: `v1.0.0-rc.1`  
Commit: not created  
Tag: withheld  
Release decision: BLOCKED

## Severity policy

- Critical: tenant escape, secret exposure, financial corruption/duplication, unrecoverable data loss, or audit-integrity loss. No exception; blocks release.
- High: authorization bypass, public-token/file exposure, malware-processing bypass, provider entitlement corruption, failed backup/restore, or failed migration/rollback. Blocks release.
- Medium: material operational failure with a safe workaround. Requires owner, mitigation, and dated fix target.
- Low: limited impact with no security, money, or data-integrity effect. Requires backlog owner.

## Gate status

| Gate | Status | Evidence / blocker |
| --- | --- | --- |
| Scope frozen at an immutable commit | BLOCKED | Worktree is not committed; no candidate tag exists. |
| Formatting/diff integrity | PARTIAL | `git diff --check` passed; no dedicated formatter command is configured. |
| Web lint/typecheck/build | BLOCKED | Typecheck and the development-configured build pass; lint has 0 errors/54 warnings; default production build fails closed until malware scanning is configured. |
| Unit/integration/contract/E2E | BLOCKED | 320 contracts, 187 unit, and 25 integration tests pass. All 11 browser assertions pass, but the Playwright process exits 124 during Windows teardown; staging remains untested. |
| Mobile typecheck/lint/export | PASS (local) | Typecheck, lint, and all-platform export pass with invalid public placeholders; production credentials/profile were not used. |
| Clean schema application | BLOCKED | No ephemeral PostgreSQL/Supabase target configured. |
| Previous stable upgrade | BLOCKED | No restored previous-release database target configured. |
| Backup and actual restore | BLOCKED | No safe source/empty restore target configured. |
| Critical E2E and negative scenarios | BLOCKED | Production-like staging identities/providers unavailable. |
| High-volume performance/load | BLOCKED | Local 25k-case screen exceeded its 10-second ceiling (10105.6 ms), and no staging load test ran. |
| Security findings | BLOCKED | Prompt 21 High findings still require staging verification. |
| Provider recovery | BLOCKED | Prompt 22 migration and sandbox drills are not verified remotely. |
| Monitoring and alert routing | BLOCKED | Owners and external alert destinations are unassigned. |
| Rollback demonstrated | BLOCKED | Documentation/scripts exist; no actual rehearsal evidence. |
| Production smoke | BLOCKED | No approved production deployment exists. |

## Completion, deferral, and risk statement

- Complete: local implementation artifacts and automated local checks only after their results are recorded.
- Deferred/unsupported: items in `SCOPE_FREEZE.md`.
- Known risk: every BLOCKED row above plus all open items in `docs/SECURITY_FINDINGS.md`.

## Signatures

Release owner: ____________________  Date/time UTC: ____________________  Decision: ____________________

Security reviewer: ________________  Date/time UTC: ____________________  Decision: ____________________

Data/restore owner: _______________  Date/time UTC: ____________________  Decision: ____________________

Application owner: ________________  Date/time UTC: ____________________  Decision: ____________________

Do not sign or change the release decision to APPROVED until every Critical/High gate is PASS with linked evidence.
