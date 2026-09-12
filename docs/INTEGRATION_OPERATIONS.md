# Production Integration Operations

This runbook covers Stripe billing, Resend email, Xero, and QuickBooks Online. Authentication alone is not a health signal: an integration becomes healthy only after a current provider operation succeeds.

## Configuration boundaries

- Production Stripe must use a live secret key, a production webhook secret, and the three price IDs corresponding to the canonical catalogue in `src/lib/billing/plans.ts`.
- Development and staging use Stripe test credentials. The application rejects a Stripe key for the wrong application environment.
- `QUICKBOOKS_ENVIRONMENT` is mandatory. Use `sandbox` outside production and `production` only in production.
- Xero, QuickBooks, Resend, Stripe, Supabase service-role, cron, webhook, and token-encryption secrets are server-only. Never prefix them with `NEXT_PUBLIC_`.
- Automated tests use fixtures and provider test modes only. Never load customer credentials into CI.

## Health meanings

- `unknown`: authorization/configuration exists, but no provider operation has proven it works.
- `healthy`: the latest real sync or delivery completed.
- `degraded`: a retryable operation failed fewer than five consecutive times.
- `outage`: repeated provider failures indicate an outage or persistent configuration fault.
- `action_required`: token revocation, currency/mapping conflict, sender/suppression issue, or another condition requiring a person.
- `disconnected`: local credentials were removed; imported history remains.

Core case, debtor, payment, promise, dispute, evidence, and audit work must remain available during provider outages.

## Reconnect Xero or QuickBooks

1. In Settings, confirm the provider status and actionable message.
2. Confirm the intended provider organization. Reconnecting a different organization over existing mappings is blocked.
3. Select Connect and approve only the displayed accounting scopes.
4. Run Preview. Authentication success alone does not mark the connection healthy.
5. Resolve currency or mapping conflicts without changing approved CollectBoss financial history.
6. Run Sync now and confirm health becomes `healthy`.
7. Record the incident/reconnect in the operational ticket. Do not paste tokens or provider payloads.

## Retry and manual replay

Automatic jobs use leases, deterministic deduplication keys, exponential backoff capped at 24 hours, and eight attempts by default. Exhausted jobs enter `dead_letter`.

1. Open Settings and inspect the masked, tenant-scoped failure.
2. Fix the underlying configuration, provider outage, mapping, or suppression issue.
3. Use **Replay safely** and enter a meaningful reason. Replay is permitted only for the owning tenant and is audit logged.
4. The worker reuses the original provider idempotency key or event ID. Never create a replacement financial outcome manually to make the queue appear healthy.
5. Confirm the job becomes `succeeded` and the provider health signal recovers.

Stripe events with failures retain only the Stripe event ID and operational error. Replay retrieves the signed event from Stripe and re-applies current subscription truth. Email retries reference the existing communication activity; message content is not copied into the retry queue.

## Reconciliation

- Accounting webhooks are hints. Scheduled polling remains authoritative and re-reads provider state with overlap.
- Each page is idempotent. A partial run can be repeated safely; completed mappings and financial application keys prevent duplicates.
- Older provider records are ignored when a newer mapping timestamp is already stored.
- Deleted/void provider records are represented through archived, void, reversal, or review states; imported audit/history is never hard deleted.
- A changed invoice currency is not applied to an existing mapped obligation. It creates `action_required` health until reviewed.
- Stripe subscription events always retrieve the current subscription before writing, so out-of-order delivery cannot restore stale entitlements.

## Email delivery and suppression

- Sent, delivered, opened, reply, failure, bounce, complaint, and provider-suppression events are visible through communication activity and Settings health.
- Bounce, complaint, and suppression events create a tenant-scoped recipient hash and masked address. Future sends fail before provider delivery.
- Lifting a suppression requires evidence that the address is valid and an audited administrative process. Direct database edits are prohibited.
- Do not log message bodies, full recipient lists, attachments, tokens, or provider payloads.

## Provider outage

1. Confirm the provider status page and CollectBoss health/failure timestamps.
2. Do not disconnect or rotate credentials solely because of a confirmed provider outage.
3. Allow retry jobs to back off. Pause the integration worker only if provider guidance requires it.
4. Continue unrelated case work.
5. When service recovers, run reconciliation, replay dead letters after review, and compare provider totals/mappings.
6. Escalate unexplained financial differences under the incident procedure in `docs/SECURITY_OPERATIONS.md`.

## Credential rotation

Follow `docs/SECURITY_OPERATIONS.md`. Rotate one provider at a time, preserve the old credential until verification succeeds where the provider permits, verify webhook delivery and a real non-destructive operation, then revoke the old credential. Rotating `ACCOUNTING_TOKEN_ENCRYPTION_KEY` requires a controlled re-encryption migration; replacing it directly makes stored OAuth tokens unrecoverable.
