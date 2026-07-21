# Release operations runbook

## Scope and ownership

This runbook is a release procedure, not evidence that an external platform has been configured. The release operator owns deployment, rollback, backup confirmation, uptime, error-log, and Stripe webhook checks. The application owner approves the release decision and PDPA/support commitments.

## Environment separation

| Environment | App mode | Supabase | Stripe | Deployment rule |
| --- | --- | --- | --- | --- |
| CI | `development` with explicit mock flag | None | None | Disposable verification only; never promote as a deployment artifact. |
| Staging | `staging` | Separate non-production project | Test mode only | Requires backup, approved migrations, and all 69 staging cases. |
| Production | `production` | Separate production project | Live mode only | Requires every release gate below; never use mock data. |

Set public variables at build time only for the environment they belong to: Next.js inlines `NEXT_PUBLIC_*` values. Keep service-role, Stripe secret, and webhook secrets server-side in the hosting provider.

## Migration, rollback, and restore gate

1. Identify and read the target project, migration history, RLS, bucket policies, and current backup status.
2. Confirm a current snapshot, a restore owner, and the rollback window.
3. Present exact compatible SQL and rollback SQL; obtain approval before applying anything.
4. Apply one approved migration group at a time. Re-read tables, functions, indexes, policies, and buckets after each group.
5. If a migration or policy test fails, stop writes and restore the confirmed non-production snapshot. Do not improvise a down-migration.
6. Run two-tenant RLS/storage checks, the 69-case matrix, and full regression. Record links to non-sensitive evidence.

## Monitoring and alerts

Before launch, configure and test these external controls with a named owner and escalation destination:

| Signal | Owner | Trigger | Evidence required |
| --- | --- | --- | --- |
| Application errors | Release operator | New 5xx surge or unhandled server exception | Redacted log event and alert receipt |
| Uptime | Release operator | Public landing/login availability failure | Synthetic probe history and alert receipt |
| Stripe webhooks | Billing owner | Failed delivery, signature rejection, or unprocessed event | Stripe Dashboard event and follow-up record |
| Database/storage | Data owner | Backup failure, RLS failure, or storage-policy regression | Backup timestamp and policy verification |
| Support/PDPA | Application owner | Privacy request, data incident, or customer report | Ticket ID and response timeline |

Never place bank details, capability tokens, payment proofs, service credentials, or raw webhook bodies in alert payloads. Use event IDs and redacted metadata only.

## Incident actions

- **Webhook incident:** disable the affected staging/production endpoint only when necessary, inspect Stripe event delivery by event ID, verify `billing_events` idempotency state, rotate the endpoint secret if exposed, then replay only approved test/staging events.
- **Authorization/storage incident:** disable the affected release, preserve redacted logs, revoke affected public tokens/signed URLs, verify policies, and restore only after a two-tenant regression pass.
- **Deployment incident:** halt promotion, roll back to the previously verified host deployment, keep the database at its compatible schema, and use the confirmed restore plan if data integrity is affected.
- **Support/PDPA incident:** acknowledge through the approved support channel, avoid requesting credentials in tickets, and follow the privacy/data-retention policy before exporting or deleting data.

## Launch rehearsal and final gates

| Gate | Current evidence | Status |
| --- | --- | --- |
| Fresh CI workflow | Local workflow authored; no hosted run exists | NOT VERIFIED |
| Staging target and backup | No verified target or snapshot | BLOCKED |
| Approved migration/RLS/storage application | No remote SQL approved or applied | BLOCKED |
| 69 staging cases | [STAGING_69_CASE_MATRIX.md](STAGING_69_CASE_MATRIX.md): 69 NOT RUN | BLOCKED |
| Automated local regression | Typecheck, lint, contract/unit, and browser tests pass | PASS (local only) |
| Production build with real configuration | Local build fails closed without Supabase config | BLOCKED |
| Monitoring, backup restore, and alert drill | No external evidence | BLOCKED |
| Stripe live readiness | No test/live remote verification | BLOCKED |

## Sign-off record

Do not sign off until every blocked gate has dated evidence, no Critical or High risk remains, and the application owner approves the release.

**Current release decision: NOT APPROVED FOR RELEASE.**
