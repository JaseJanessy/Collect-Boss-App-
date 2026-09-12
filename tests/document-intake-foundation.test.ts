import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/20260831_secure_document_intake_foundation.sql");
const createRoute = read("src/app/api/document-intakes/route.ts");
const intakeRoute = read("src/app/api/document-intakes/[intakeId]/route.ts");
const evidenceRoute = read("src/app/api/document-intakes/[intakeId]/evidence/route.ts");
const replaceRoute = read("src/app/api/document-intakes/[intakeId]/evidence/[evidenceId]/replace/route.ts");
const previewRoute = read("src/app/api/document-intakes/[intakeId]/evidence/[evidenceId]/preview/route.ts");
const server = read("src/lib/document-intake/server.ts");
const validation = read("src/lib/document-intake/validation.ts");

test("drafts, placeholders, lifecycle events and retry-safe idempotency are additive", () => {
  for (const table of ["document_intakes", "document_intake_extractions", "document_intake_confirmations", "document_intake_events", "document_intake_idempotency_keys"]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
  }
  for (const status of ["draft", "awaiting_upload", "uploaded", "processing", "needs_review", "ready_to_submit", "submitted", "failed", "cancelled"]) {
    assert.match(migration, new RegExp(`'${status}'`));
  }
  assert.match(migration, /unique \(business_id,action_scope,idempotency_key\)/);
  assert.match(migration, /attempt_count integer not null default 0/);
  assert.match(migration, /next_attempt_at timestamptz/);
  assert.match(migration, /P8_INVALID_STATUS_TRANSITION/);
  assert.match(migration, /P8_USE_FINALISE/);
});

test("existing evidence is extended for immutable originals, derivatives and replacement versions", () => {
  assert.match(migration, /alter table public\.evidence_files[\s\S]*add column if not exists intake_id/);
  assert.match(migration, /kind in \('original','thumbnail','page_image','derived'\)/);
  assert.match(migration, /evidence_files_intake_original_version_uidx/);
  assert.match(migration, /P8_ORIGINAL_IMMUTABLE/);
  assert.match(migration, /before update on public\.evidence_files/);
  assert.match(migration, /P8_EVIDENCE_RETENTION_REQUIRED/);
  assert.match(migration, /supersedes_evidence_id/);
  assert.match(migration, /document_evidence\.replaced/);
  assert.doesNotMatch(replaceRoute, /\.update\(\{\s*object_path/);
});

test("private storage, exact duplicate warnings and tenant scoping do not leak across businesses", () => {
  assert.match(migration, /values\('transaction-evidence','transaction-evidence',false/);
  assert.match(migration, /no authenticated\/anonymous storage\.objects policy/i);
  assert.match(migration, /where business_id=p_business_id and content_sha256=p_sha256/);
  assert.match(migration, /exact_hash_warning/);
  assert.match(server, /\.eq\("business_id", input\.access\.businessId\)/);
  assert.match(previewRoute, /\.eq\("business_id", access\.businessId\)/);
  assert.match(previewRoute, /scan_status !== "clean"/);
  assert.match(previewRoute, /secureStoredFileResponse/);
  assert.match(previewRoute, /\.download\(objectPath\)/);
  assert.doesNotMatch(previewRoute, /createSignedUrl/);
  assert.doesNotMatch(evidenceRoute, /object_path|content_sha256/);
});

test("session roles are reused, viewers cannot write and manager submission is configurable", () => {
  for (const route of [createRoute, intakeRoute, evidenceRoute, replaceRoute, previewRoute]) {
    assert.match(route, /requireDocumentPermission/);
  }
  assert.match(server, /requireTenantPermission/);
  assert.match(server, /requireMobilePermission/);
  assert.match(createRoute, /document_intake\.create/);
  assert.match(previewRoute, /document_intake\.read/);
  assert.match(intakeRoute, /document_intake\.submit/);
  assert.match(migration, /manager_can_submit_document_intakes/);
  assert.match(migration, /status='active'/);
  assert.match(migration, /v_role='viewer'/);
  assert.match(validation, /createDocumentIntakeSchema[\s\S]*\.strict\(\)/);
  assert.doesNotMatch(validation, /createDocumentIntakeSchema[\s\S]{0,500}(businessId|business_id)/);
  assert.match(createRoute, /from\("businesses"\)\.select\("default_currency"\)/);
  assert.match(createRoute, /p_currency_hint: business\.default_currency/);
});

test("upload metadata failure performs compensating cleanup and records cleanup failure", () => {
  assert.match(server, /const cleanupPaths = \[storage\.objectPath, previewStorage\?\.objectPath\]/);
  assert.match(server, /storage[\s\S]*\.remove\(cleanupPaths\)/);
  assert.match(server, /document_evidence\.cleanup_failed/);
  assert.match(server, /STORAGE_CLEANUP_FAILED/);
  assert.match(server, /recordUploadFailure[\s\S]*METADATA_WRITE_FAILED/);
  assert.match(server, /document_evidence\.upload_failed/);
});

test("database writes are atomic RPCs and client-facing errors remain stable", () => {
  for (const fn of ["document_intake_create", "document_intake_attach_evidence", "document_intake_confirm", "document_intake_finalise", "document_intake_cancel"]) {
    assert.match(migration, new RegExp(`create or replace function public\\.${fn}`));
    assert.match(migration, new RegExp(`revoke all on function public\\.${fn}`));
  }
  assert.match(createRoute, /document_intake_create/);
  assert.match(evidenceRoute, /storeOriginalEvidence/);
  assert.match(intakeRoute, /document_intake_finalise/);
  assert.doesNotMatch([createRoute, intakeRoute, evidenceRoute, replaceRoute, previewRoute].join("\n"), /error\.message\s*[},]/);
});
