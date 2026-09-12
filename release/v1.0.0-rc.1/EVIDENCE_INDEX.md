# Release evidence index

Do not record credentials, customer data, full provider payloads, bank details, documents, or public capability tokens.

Local results below were captured on Windows 11, Node 24.18.0, npm 11.6.2, at commit `a74debd` plus an uncommitted working tree. They are diagnostic evidence only and cannot approve a release candidate.

| Gate | Environment | Timestamp UTC | Operator | Result | Evidence link or artifact hash |
| --- | --- | --- | --- | --- | --- |
| Commit and dependency lock | Local | 2026-08-13 06:19:32Z | Codex | BLOCKED | Worktree is uncommitted; tag withheld. |
| Web quality suite | Local | 2026-08-13 06:19:32Z | Codex | FAIL | Typecheck PASS; lint PASS with 54 warnings; 320 contracts, 187 unit and 25 integration tests PASS; secret scan PASS across 698 files/history; development-configured 82-page build PASS; default production build correctly fails because malware scanning is unconfigured. |
| Mobile quality/export | Local | 2026-08-13 06:19:32Z | Codex | PASS (local) | Typecheck and lint PASS; Expo export PASS for web, Android, and iOS using invalid public placeholders and no production profile. |
| Clean database apply | Ephemeral | Not recorded | Unassigned | NOT RUN | No empty PostgreSQL/Supabase target was provided. |
| Previous-release upgrade | Ephemeral | Not recorded | Unassigned | NOT RUN | No previous-release restore target was provided. |
| Backup and restore | Non-production | Not recorded | Unassigned | NOT RUN | No safe source and empty restore target were provided. |
| Security/RLS invariants | Staging | Not recorded | Unassigned | NOT RUN | Three High findings still require staging verification. |
| Critical E2E scenario | Local | 2026-08-13 06:19:32Z | Codex | FAIL | All 11 Playwright assertions passed, but the command timed out during Windows web-server teardown and exited 124; production-like staging scenario remains 0/69. |
| Negative scenarios | Staging | Not recorded | Unassigned | NOT RUN | Local static and browser contracts do not replace tenant/provider staging evidence. |
| Performance/load | Local | 2026-08-13 06:19:32Z | Codex | FAIL | 25k-case screen took 10105.6 ms against a 10000 ms ceiling; other three screens passed. No staging load test ran. |
| Provider integration drills | Staging | Not recorded | Unassigned | NOT RUN | Stripe, email, Xero, and QuickBooks sandbox drills were not available. |
| Monitoring alert drill | Staging | Not recorded | Unassigned | NOT RUN | Owners and external alert routes remain unassigned. |
| Production smoke | Production | Not recorded | Unassigned | NOT RUN | No approved production deployment exists. |
| Rollback rehearsal | Non-production | Not recorded | Unassigned | NOT RUN | Restore and rollback were not demonstrated. |

