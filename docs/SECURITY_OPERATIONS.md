# CollectBoss Security Operations

## Scope and ownership

This runbook covers suspected tenant-data exposure, compromised staff or debtor capability access, leaked credentials, unsafe file access, audit-integrity alerts, and abuse of public or authentication-sensitive endpoints. It is an operational procedure, not a claim that CollectBoss has undergone an independent penetration test.

The incident commander owns containment decisions and the evidence timeline. A database owner performs Supabase changes, the payment owner performs Stripe rotation, and the communications owner performs email/SMS provider rotation. Preserve exact timestamps, actor IDs, request IDs, affected tenant IDs, and hashes; never paste raw credentials, OTPs, full bank details, or public capability tokens into tickets or chat.

## Severity and first response

| Severity | Example | Initial target |
| --- | --- | --- |
| Critical | Confirmed cross-tenant read/write, service-role key exposure, forged payment destination, destructive audit tampering | Contain immediately; disable affected path or credentials |
| High | Reusable or leaked public capability, unauthorized sensitive-file access, role escalation, valid webhook forgery | Contain within one hour |
| Medium | Sustained enumeration, rate-limit bypass, excessive data returned to an otherwise authorized role | Contain during the same operating day |
| Low | Hardening gap with no demonstrated access or sensitive-data effect | Schedule and track remediation |

1. Open a restricted incident record and assign an incident commander.
2. Preserve relevant application, Supabase, provider, and deployment logs. Record hashes of exported evidence.
3. Contain narrowly: revoke affected public links and payment sessions, suspend affected memberships, disable the specific endpoint or integration, or rotate the specific credential.
4. Do not weaken RLS, enable public buckets, or switch production to mock data during containment.
5. Determine affected tenants, records, files, time range, actor/session IDs, and whether data was read, changed, exported, or merely exposed.
6. Follow applicable contractual and regulatory notification decisions with qualified legal/privacy counsel. This runbook does not invent a notification deadline.
7. Restore only after negative tenant/role/token/file tests pass and the incident commander records residual risk.

## Credential rotation

Use provider dashboards or approved secret management; never commit new values. Rotate in this order so verification remains available during deployment:

1. Create the replacement credential with the minimum required scope.
2. Add it to the deployment secret store and a non-production environment.
3. Deploy and verify the relevant health check, signed webhook, scheduled job, or privileged operation.
4. Promote to production, verify again, then revoke the old credential.
5. Search source and repository history with `npm run test:secrets`. If a real secret was committed, rotate it even if the commit was later removed; rewrite history only under a coordinated repository incident procedure.
6. Record the credential name, provider, rotation time, operator, deployment ID, verification evidence, and old-credential revocation time. Never record the credential value.

Credential-specific notes:

- `SUPABASE_SERVICE_ROLE_KEY`: treat exposure as critical. Rotate in Supabase, redeploy every server/worker, revoke active public payment sessions, and review service-role queries and audit hashes.
- Supabase anon key: rotate if necessary, update web/mobile builds, and verify that RLS—not key secrecy—still denies cross-tenant access.
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`: rotate independently, update endpoint signing secrets, verify a signed test event, and inspect billing event idempotency records.
- `CRON_SECRET`, `LEGAL_HANDOFF_WEBHOOK_SECRET`, `RESEND_WEBHOOK_SECRET`: rotate the sender and receiver together, then reject the old credential with a negative test.
- `PAYMENT_ACCESS_OTP_PEPPER`: rotation invalidates verification of outstanding OTP material. Revoke active OTP challenges/sessions, rotate, deploy, and require fresh verification.
- Accounting/email/SMS provider secrets: rotate per provider, verify tenant-to-provider mapping before reenabling synchronization or delivery.

## Public capabilities and files

Public capabilities are opaque, stored only as hashes, tenant-bound, purpose-bound, expiring, revocable, and single-use where the workflow requires it. Never log raw capability values. Revoke a capability when its case closes, payment destination changes, verification becomes unsafe, or leakage is suspected.

Sensitive buckets must remain private. Application routes re-check tenant permission or capability/session state on every download and return `no-store`, `no-referrer`, same-origin, and `nosniff` headers. Do not reintroduce direct or long-lived storage URLs. After revocation, test the application URL again and confirm it fails before declaring containment complete.

## Audit-integrity verification

Audit rows are append-only. New rows include a tenant-local SHA-256 predecessor hash. Periodically export `id`, `business_id`, `created_at`, `previous_event_hash`, and `event_hash` to protected evidence storage and verify continuity. A missing row, duplicate fork, unexpected genesis, or hash mismatch is a high-severity signal; preserve the database snapshot and restrict privileged writes while investigating. Rows created before the Prompt 21 migration are intentionally unhashed and form the documented legacy boundary.

## Recovery checklist

- RLS is enabled and deny-by-default for tenant and service-only security tables.
- Cross-tenant read, write, export, identifier-guessing, and role-escalation tests pass.
- Revoked/expired capability and file requests fail without confirming whether the identifier existed.
- Public and privileged mutation endpoints enforce validation, origin controls, shared rate limits where applicable, and structured errors.
- Authentication, case/debtor/payment/promise/dispute/evidence/public portal/billing/audit core flows pass in staging.
- All affected credentials are rotated and old credentials are revoked.
- Findings include severity, cause, remediation, verification evidence, affected versions, and residual risk.

## Current residual risks

- The database migration must be reviewed and applied before deploying the application changes; public routes fail closed if the shared limiter RPC is unavailable.
- The in-process proxy limiter remains a fast first layer, while the database limiter supplies cross-instance enforcement for public capability routes. Platform/WAF rate limiting is still recommended for volumetric attacks.
- Audit hash chaining makes tampering evident but does not replace external immutable log export or independent monitoring.
- A qualified independent penetration test has not been performed by this change set.
