import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/20260916_pocket_receipt_capture_confirmation.sql");
const quotaMigration = read("supabase/migrations/20260913_pocket_entitlements_billing_usage.sql");
const uploadRoute = read("src/app/api/pocket/receipts/route.ts");
const processRoute = read("src/app/api/pocket/receipts/[intakeId]/route.ts");
const reviewRoute = read("src/app/api/pocket/receipts/[intakeId]/review/route.ts");
const confirmRoute = read("src/app/api/pocket/receipts/[intakeId]/confirm/route.ts");
const component = read("src/components/pocket/pocket-receipts.tsx");
const sharedServer = read("src/lib/document-intake/server.ts");

test("Pocket capture reuses private immutable document intake and never creates another OCR pipeline", () => {
  assert.match(uploadRoute, /storeOriginalEvidence/);
  assert.match(uploadRoute, /p_intended_workflow:\s*"payment_evidence"/);
  assert.match(sharedServer, /DOCUMENT_EVIDENCE_BUCKET/);
  assert.match(sharedServer, /validateDocumentUpload/);
  assert.doesNotMatch(migration, /create table[^;]*(?:ocr|extraction)_/i);
});

test("camera, image, and PDF controls keep human confirmation explicit", () => {
  assert.match(component, /Take Photo/);
  assert.match(component, /Choose Image/);
  assert.match(component, /Upload PDF/);
  assert.match(component, /Retake/);
  assert.match(component, /Replace Receipt/);
  assert.match(component, /blurred/i);
  assert.match(component, /possible_glare/i);
  assert.match(component, /very_dark/i);
  assert.match(component, /Nothing is posted until you review and confirm it/);
  assert.match(component, /Confirm Payment/);
});

test("security scan precedes shared extraction and source-hash quota is retry-safe", () => {
  assert.match(processRoute, /evidence\.scan_status !== "clean"/);
  assert.match(processRoute, /document_intake_requeue_extraction/);
  assert.match(quotaMigration, /'ocr:'\|\|coalesce\(v_hash,new\.evidence_id::text\)/i);
  assert.match(quotaMigration, /workspace_usage_events[\s\S]*operation_key/i);
  assert.match(quotaMigration, /if exists\(select 1 from public\.workspace_usage_events/i);
});

test("review saves shared candidate provenance before the payment handoff", () => {
  assert.match(reviewRoute, /prepareDocumentReview/);
  assert.match(reviewRoute, /document_intake_save_review/);
  assert.match(migration, /review_status='confirmed'/i);
  assert.match(migration, /extraction_id=v_extraction\.id/i);
  assert.match(migration, /public\.pocket_post_payment\(/i);
});

test("confirmation is atomic, idempotent, append-only, and links evidence to shared payment truth", () => {
  assert.match(confirmRoute, /Idempotency-Key/i);
  assert.match(confirmRoute, /pocket_confirm_receipt_payment/);
  assert.match(migration, /payment_operation_idempotency_keys[\s\S]*pocket_confirm_receipt_payment/i);
  assert.match(migration, /pocket_receipt_payment_links_append_only_guard/i);
  assert.match(migration, /allocation_id[\s\S]*receipt_id[\s\S]*debt_id[\s\S]*customer_id/i);
  assert.doesNotMatch(migration, /delete from public\.(?:payment|evidence|document)/i);
});

test("duplicate, tenant, role, stale-review, and authoritative-balance guards remain server-side", () => {
  assert.match(migration, /business_id=p_business_id/g);
  assert.match(migration, /v_role not in\('owner','admin','manager'\)/i);
  assert.match(migration, /duplicate_match_status='exact_hash_warning'/i);
  assert.match(migration, /payment_receipts prior[\s\S]*amount_minor=v_confirmation\.chosen_amount_minor[\s\S]*received_at at time zone/i);
  assert.match(migration, /POCKET_RECEIPT_DUPLICATE_REVIEW_REQUIRED/);
  assert.match(migration, /p_expected_outstanding_minor/);
  assert.match(migration, /POCKET_RECEIPT_REVIEW_STALE/);
});

test("weak customer names are never auto-selected", () => {
  assert.match(component, /suggestedCustomer\?\.strongIdentifierMatch/);
  assert.match(component, /No strong identifier match was found\. Choose manually\./);
  assert.doesNotMatch(component, /setCustomerId\(data\.suggestedCustomer\.customerId\)[\s\S]*confidence===0\.45/);
});
