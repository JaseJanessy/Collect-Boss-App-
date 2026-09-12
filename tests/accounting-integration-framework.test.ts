import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/20260826_accounting_integration_framework.sql");
const schema = read("supabase/schema.sql");
const rls = read("src/lib/supabase/rls.sql");

test("accounting adapters share normalized reads and controlled payment-allocation write-back", () => {
  const types = read("src/lib/accounting/types.ts");
  const xero = read("src/lib/accounting/providers/xero.ts");
  const quickbooks = read("src/lib/accounting/providers/quickbooks.ts");
  for (const capability of ["contacts", "invoices", "payments", "creditNotes", "incremental", "writeBack"]) {
    assert.match(types, new RegExp(capability));
  }
  assert.match(types, /writeBack: boolean/);
  assert.match(types, /createPaymentAllocation/);
  assert.match(xero, /AccountingAdapter/);
  assert.match(quickbooks, /AccountingAdapter/);
  assert.match(xero, /If-Modified-Since/);
  assert.match(quickbooks, /Metadata\.LastUpdatedTime/);
  assert.match(xero, /createPaymentAllocation[\s\S]*method:\s*["']PUT["']/);
  assert.match(quickbooks, /createPaymentAllocation[\s\S]*method:\s*["']POST["']/);
  assert.doesNotMatch(xero, /method:\s*["']PATCH["']/);
  assert.doesNotMatch(quickbooks, /method:\s*["']PATCH["']/);
});

test("stable mappings and transactional batches prevent replay duplicates", () => {
  assert.match(migration, /unique \(business_id,provider,entity_type,external_entity_id\)/i);
  assert.match(migration, /unique \(provider,event_key\)/i);
  assert.match(migration, /accounting_sync_runs_one_active_idx/i);
  assert.match(migration, /accounting_apply_sync_batch[\s\S]*jsonb_array_elements[\s\S]*accounting_apply_sync_record/i);
  assert.match(migration, /on conflict \(business_id,application_key\) do nothing/i);
  assert.match(schema, /create table if not exists public\.accounting_external_mappings/i);
});

test("external payments and credits reuse the financial ledger and receivables projection", () => {
  assert.match(migration, /insert into public\.case_financial_events[\s\S]*'payment_approved'/i);
  assert.match(migration, /insert into public\.payments[\s\S]*'approved'/i);
  assert.match(migration, /'adjustment_credit'/i);
  assert.match(migration, /perform public\.financial_recalculate_case\(v_case_id\)/i);
  assert.match(migration, /set_config\('collectboss\.receivables_sync','on',true\)/i);
  assert.match(migration, /unique \(business_id,application_key\)/i);
});

test("OAuth secrets remain encrypted, server-only and tenant-scoped", () => {
  const crypto = read("src/lib/accounting/crypto.ts");
  const api = read("src/app/api/integrations/accounting/route.ts");
  assert.match(crypto, /aes-256-gcm/i);
  assert.match(crypto, /ACCOUNTING_TOKEN_ENCRYPTION_KEY/);
  assert.match(api, /requireTenantPermission\("settings\.sensitive\.manage"\)/);
  assert.match(api, /\.eq\("business_id", access\.businessId\)/);
  assert.match(migration, /alter table public\.accounting_connections enable row level security/i);
  assert.doesNotMatch(migration, /create policy[^;]+on public\.accounting_connections/is);
  assert.match(rls, /accounting_external_mappings_role_read[\s\S]*has_business_permission\(business_id,'settings\.sensitive\.manage'\)/i);
  assert.match(migration, /revoke all on function public\.accounting_apply_sync_batch\(uuid,jsonb\) from public,anon,authenticated/i);
});

test("disconnect preserves imported history and Settings owns the integration UI", () => {
  const api = read("src/app/api/integrations/accounting/route.ts");
  const settings = read("src/components/pages/business-settings-page.tsx");
  const panel = read("src/components/settings/accounting-integrations-panel.tsx");
  const desktopSidebar = read("src/components/shells/dashboard-shell.tsx");
  const mobileSidebar = read("src/components/shells/mobile-shell.tsx");
  assert.match(api, /status: "disconnected"/);
  assert.match(api, /access_token_ciphertext: null/);
  assert.doesNotMatch(api, /\.delete\(\)/);
  assert.doesNotMatch(migration, /delete from public\.(?:debtors|obligations|cases|payments|payment_promises|payment_plans)/i);
  assert.match(settings, /AccountingIntegrationsPanel/);
  assert.match(panel, /Preview/);
  assert.match(panel, /Imported history and mappings will be preserved/);
  assert.doesNotMatch(desktopSidebar, /Xero|QuickBooks/);
  assert.doesNotMatch(mobileSidebar, /Xero|QuickBooks/);
});

test("provider events are verified, durably queued and reconciled by polling fallback", () => {
  const webhook = read("src/app/api/integrations/accounting/webhooks/[provider]/route.ts");
  const sync = read("src/lib/accounting/sync.ts");
  const cron = read("src/app/api/cron/accounting-sync/route.ts");
  assert.match(webhook, /createHmac\("sha256"/);
  assert.match(webhook, /timingSafeEqual/);
  assert.match(webhook, /accounting_webhook_events/);
  assert.match(sync, /modifiedSince/);
  assert.match(sync, /status: "processed"/);
  assert.match(cron, /authorizeCronRequest/);
  assert.match(read("vercel.json"), /api\/cron\/accounting-sync/);
});
