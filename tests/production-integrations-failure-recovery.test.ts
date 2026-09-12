import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/20260911_production_integrations_failure_recovery.sql");
const queue = read("src/lib/integrations/queue.ts");
const worker = read("src/lib/integrations/worker.ts");

test("integration retries are leased, exponentially delayed, dead-lettered, and service-only", () => {
  assert.match(migration, /create table if not exists public\.integration_jobs/i);
  assert.match(migration, /for update skip locked/i);
  assert.match(migration, /power\(2,least\(attempts,10\)\)/i);
  assert.match(migration, /'dead_letter'/i);
  assert.match(migration, /revoke all on function public\.integration_claim_jobs\(integer\) from public,anon,authenticated/i);
  assert.match(queue, /deduplication_key: integrationJobKey/);
  assert.match(worker, /syncAccountingConnection\(connectionId, mode, \{ enqueueFailure: false \}\)/);
});

test("manual replay is tenant-bound, reasoned, audited, and cannot replay successful jobs", () => {
  const route = read("src/app/api/integrations/jobs/[jobId]/replay/route.ts");
  assert.match(route, /requireTenantPermission\("settings\.sensitive\.manage"\)/);
  assert.match(route, /\.eq\("business_id", access\.businessId\)/);
  assert.match(route, /min\(10\)\.max\(500\)/);
  assert.match(route, /\["retry_scheduled", "dead_letter"\]/);
  assert.match(route, /integration\.job_replayed/);
});

test("accounting OAuth and sync preserve organization ownership and recover revoked access", () => {
  const callback = read("src/app/api/integrations/accounting/[provider]/callback/route.ts");
  const sync = read("src/lib/accounting/sync.ts");
  const quickbooks = read("src/lib/accounting/providers/quickbooks.ts");
  assert.match(callback, /adapter\.requiredScopes\.filter/);
  assert.match(callback, /already mapped to a different organization/);
  assert.match(sync, /OAUTH_RECONNECT_REQUIRED/);
  assert.match(sync, /changed currency from/);
  assert.match(sync, /source_updated_at/);
  assert.match(quickbooks, /Non-production environments cannot use the QuickBooks production API/);
});

test("Stripe webhook replay uses current provider truth and atomic billing state", () => {
  const route = read("src/app/api/stripe/webhook/route.ts");
  const processor = read("src/lib/billing/stripe-events.ts");
  const service = read("src/lib/billing/service.ts");
  assert.match(route, /stripe\.webhooks\.constructEvent\(rawBody/);
  assert.match(route, /enqueueIntegrationJob/);
  assert.match(worker, /stripe\.events\.retrieve\(eventId\)/);
  assert.match(processor, /stripe\.subscriptions\.retrieve/);
  assert.match(processor, /applySubscriptionState\(params\)/);
  assert.match(service, /rpc\("billing_claim_event"/);
  assert.match(service, /billing_apply_subscription_state/);
  assert.match(migration, /billing_claim_event/);
  assert.match(migration, /for update/i);
  assert.match(migration, /on conflict\(business_id\) do update/i);
});

test("email failures are visible, retryable, and suppressed without copying message content", () => {
  const service = read("src/lib/email/service.ts");
  const webhook = read("src/app/api/webhooks/resend/route.ts");
  const suppression = read("src/lib/email/suppression.ts");
  assert.match(service, /assertRecipientsNotSuppressed/);
  assert.match(service, /jobType: "email_delivery"/);
  assert.match(webhook, /email\.complained/);
  assert.match(webhook, /provider_created_at/);
  assert.doesNotMatch(webhook, /payload: event as unknown as Json/);
  assert.match(suppression, /createHash\("sha256"\)/);
  assert.match(migration, /masked_recipient text not null/i);
});

test("pricing and entitlements share the canonical plan catalogue", () => {
  const plans = read("src/lib/billing/plans.ts");
  const landing = read("src/components/pages/landing-page.tsx");
  const catalog = read("src/lib/billing/catalog-server.ts");
  assert.match(landing, /PLAN_ORDER\.map/);
  assert.match(landing, /PLANS\[slug\]/);
  assert.doesNotMatch(landing, /RM 149|Up to 50 active cases|Up to 5 active cases/);
  assert.match(catalog, /PRICE_ENV_NAMES/);
  assert.match(plans, /planFeatureLabels/);
  assert.match(read("supabase/billing.sql"), /\('Starter', 'starter', 19,\s+20, 5,\s+1/);
  assert.match(read("supabase/billing.sql"), /billing_events_retry_idx/);
});

test("operator runbooks cover reconnect, replay, reconciliation, suppression, and outage", () => {
  const runbook = read("docs/INTEGRATION_OPERATIONS.md");
  for (const heading of ["Reconnect Xero or QuickBooks", "Retry and manual replay", "Reconciliation", "Email delivery and suppression", "Provider outage", "Credential rotation"]) {
    assert.match(runbook, new RegExp(heading));
  }
  assert.match(runbook, /Authentication alone is not a health signal/);
});
