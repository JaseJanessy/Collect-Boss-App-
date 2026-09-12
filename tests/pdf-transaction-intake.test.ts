import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');
const migration = read('supabase/migrations/20260901_pdf_transaction_file_intake.sql');
const validation = read('shared/pdf-intake.ts') + read('src/lib/document-intake/validation.ts');
const server = read('src/lib/document-intake/server.ts');
const createRoute = read('src/app/api/document-intakes/route.ts');
const uploadRoute = read('src/app/api/document-intakes/[intakeId]/evidence/route.ts');
const replaceRoute = read('src/app/api/document-intakes/[intakeId]/evidence/[evidenceId]/replace/route.ts');
const removeRoute = read('src/app/api/document-intakes/[intakeId]/evidence/[evidenceId]/route.ts');
const previewRoute = read('src/app/api/document-intakes/[intakeId]/evidence/[evidenceId]/preview/route.ts');
const mobileApi = read('mobile/src/lib/transaction-intake.ts');
const mobileUi = read('mobile/src/components/collectboss-app.tsx');

test('Phase D is PDF-only and repeats critical validation on the server', () => {
  assert.match(validation, /\.endsWith\("\.pdf"\)/);
  assert.match(validation, /application\/pdf/);
  assert.match(validation, /%PDF-/);
  assert.match(validation, /%%EOF/);
  assert.match(validation, /startxref/);
  assert.match(validation, /\/Encrypt/);
  assert.match(validation, /PDF_TOO_LARGE/);
  assert.match(validation, /PDF_TOO_MANY_PAGES/);
  assert.match(server, /validateDocumentUpload\(input\.file, bytes\)/);
  assert.match(migration, /allowed_mime_types[\s\S]*array\['application\/pdf'\]/);
  assert.doesNotMatch(migration, /array\['application\/pdf','image\/png'/);
});

test('mobile bearer requests use server-resolved tenant permissions', () => {
  for (const route of [createRoute, uploadRoute, replaceRoute, removeRoute, previewRoute]) {
    assert.match(route, /requireDocumentPermission/);
  }
  assert.match(server, /startsWith\("Bearer "\)/);
  assert.match(server, /requireMobilePermission/);
  assert.match(uploadRoute, /document_intake\.create/);
  assert.match(previewRoute, /document_intake\.read/);
  assert.doesNotMatch([createRoute, uploadRoute, replaceRoute, removeRoute].join('\n'), /business[_I]d.*form|get\("business/i);
});

test('uploads are idempotent, duplicate warnings are tenant-scoped, and replacements are versioned', () => {
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /where business_id=p_business_id and content_sha256=p_sha256/);
  assert.match(migration, /exact_hash_warning/);
  assert.match(migration, /evidence_version/);
  assert.match(migration, /supersedes_evidence_id/);
  assert.match(replaceRoute, /actionScope: "replace"/);
  assert.match(mobileUi, /actionGate\.current/);
  assert.match(mobileApi, /Idempotency-Key/);
});

test('remove and cancel retain originals and write audit events', () => {
  assert.match(removeRoute, /document_intake_remove_evidence/);
  assert.match(migration, /soft_deleted_at=now\(\)/);
  assert.match(migration, /document_evidence\.removed/);
  assert.match(migration, /object_retained',true/);
  assert.match(migration, /document_intake_idempotency_keys[\s\S]*'remove'/);
  assert.match(mobileUi, /The original remains retained in the audit record/);
});

test('focused mobile flow renders validation, progress, retry, persistence, preview and guarded continue states', () => {
  for (const text of ['Upload PDF', 'Choose Screenshot/Image', 'Uploading', 'Retry upload', 'Save Draft', 'Continue', 'Replace', 'Remove evidence', 'Preview']) {
    assert.match(mobileUi, new RegExp(text));
  }
  assert.match(mobileUi, /disabled={!canContinue}/);
  assert.match(mobileUi, /listTransactionIntakes/);
  assert.match(mobileUi, /Saved evidence drafts/);
  assert.match(mobileApi, /createUploadTask/);
  assert.match(mobileUi, /cancelAsync/);
  assert.match(mobileApi, /totalBytesSent/);
  assert.match(mobileUi, /This file may already have been uploaded\./);
  assert.match(mobileUi, /No case or payment has been created\./);
  assert.match(mobileUi, /Text extraction/);
  assert.match(mobileUi, /Extracted candidates — review only/);
});

test('navigation keeps the five requested mobile destinations and adds scoped entry points', () => {
  for (const label of ["'Home'", "'cases'", "'payments'", "'reports'", "'More'"]) assert.match(mobileUi, new RegExp(label));
  assert.match(mobileUi, /Scan transaction/);
  assert.match(mobileUi, /New case from transaction PDF/);
  assert.doesNotMatch(mobileUi, /id: 'transaction-intake'.*label:.*tab/);
});
