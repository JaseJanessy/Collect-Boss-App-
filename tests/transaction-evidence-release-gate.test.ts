import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/20260906_transaction_evidence_release_hardening.sql");
const schema = read("supabase/schema.sql");
const rls = read("src/lib/supabase/rls.sql");
const proxy = read("src/proxy.ts");
const workflowRoute = read("src/app/api/document-intakes/[intakeId]/workflow/route.ts");
const mobileWorkflow = read("mobile/src/components/transaction-routing.tsx");
const scannerProvider = read("src/lib/document-intake/scanning/provider.ts");
const scannerWorker = read("src/lib/document-intake/scanning/worker.ts");
const nextConfig = read("next.config.ts");

test("Prompts 8 through 14 have ordered release-gate artifacts", () => {
  for (const file of [
    "20260831_secure_document_intake_foundation.sql",
    "20260901_pdf_transaction_file_intake.sql",
    "20260902_image_receipt_intake.sql",
    "20260903_document_extraction_intelligence.sql",
    "20260904_structured_financial_party_candidates.sql",
    "20260905_human_review_evidence_confirmation.sql",
    "20260904_profile_matching_draft_to_case.sql",
  ]) assert.ok(read(`supabase/migrations/${file}`).length > 100, `${file} is missing`);
  const prompt14 = read("supabase/migrations/20260904_profile_matching_draft_to_case.sql");
  assert.match(prompt14, /add column if not exists review_status text not null default 'draft'/u);
});

test("scan queue is leased, bounded, retryable, provenance-preserving, and service-only", () => {
  assert.match(migration, /for update of file skip locked/u);
  assert.match(migration, /scan_locked_at<p_now-interval '2 minutes'/u);
  assert.match(migration, /scan_attempt_count<5/u);
  assert.match(migration, /document_evidence_requeue_scan/u);
  assert.match(migration, /v_role is null or v_role not in \('owner','manager'\)/u);
  assert.match(migration, /v_file\.scan_status<>'failed'/u);
  assert.match(migration, /scan_provider_version/u);
  assert.match(migration, /p_scanned_sha256<>v_file\.content_sha256/u);
  assert.match(scannerWorker, /const maxJobs = 3/u);
  assert.match(scannerWorker, /const timeoutMs = 30_000/u);
  assert.match(scannerWorker, /EVIDENCE_HASH_MISMATCH[\s\S]*retryable: false/u);
  assert.match(rls, /document_evidence_claim_scan\(text,timestamptz\)[\s\S]*service_role/u);
});

test("production scanning configuration fails closed and secrets stay server-only", () => {
  assert.match(scannerProvider, /endpoint must use HTTPS/u);
  assert.match(scannerProvider, /DOCUMENT_MALWARE_SCANNER_ALLOW_THIRD_PARTY/u);
  assert.match(scannerProvider, /environment === "development"/u);
  assert.match(nextConfig, /document malware scanning must be configured for staging and production/u);
  assert.doesNotMatch(scannerProvider, /NEXT_PUBLIC_DOCUMENT_MALWARE/u);
  assert.doesNotMatch(scannerWorker + workflowRoute, /console\.(?:log|error|warn)/u);
});

test("exact duplicates and route mismatches are blocked before an outcome can post", () => {
  assert.match(migration, /before insert on public\.document_intake_outcomes/u);
  assert.match(migration, /P15_EXACT_DUPLICATE_BLOCKED/u);
  assert.match(migration, /P15_TRANSACTION_NATURE_MISMATCH/u);
  assert.match(migration, /pg_advisory_xact_lock/u);
  assert.match(workflowRoute, /match\.confidence === "exact"/u);
  assert.match(mobileWorkflow, /Exact duplicate blocked/u);
  assert.match(mobileWorkflow, /hasExactDuplicate \? null : <Button label="Continue as separate record"/u);
});

test("module rate limits cover each privileged document operation", () => {
  for (const scope of ["create", "upload", "extract", "preview", "final-submit", "write"]) {
    assert.match(proxy, new RegExp(`scope: "${scope}"`));
  }
  assert.match(proxy, /pathname\.endsWith\("\/extraction"\)/u);
  assert.match(migration, /P15_FINAL_SUBMIT_RATE_LIMITED/u);
});

test("review logs are redacted and health metrics expose no document payload", () => {
  assert.match(migration, /document_intake_redact_review_log/u);
  assert.match(migration, /correction_count/u);
  assert.match(migration, /citation_count/u);
  for (const metric of ["uploads", "scans", "extractions", "average_latency_ms", "manual_corrections", "duplicate_warnings", "final_submits", "stuck_scans", "stuck_extractions", "orphan_cleanup_failures"]) {
    assert.match(migration, new RegExp(`'${metric}'`));
  }
  assert.doesNotMatch(migration.slice(migration.indexOf("document_intake_module_health")), /original_text|protected_raw_result|bank_reference/u);
});

test("canonical schema and RLS reference include Prompt 15 controls", () => {
  assert.match(schema, /Prompt 15: transaction-evidence module release hardening/u);
  assert.match(schema, /document_intake_outcome_release_guard/u);
  assert.match(rls, /Prompt 15 scanner and release-health RPCs remain service-role-only/u);
});
