import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/20260903_document_extraction_intelligence.sql");
const schema = read("supabase/schema.sql");
const rls = read("src/lib/supabase/rls.sql");
const worker = read("src/lib/document-intake/extraction/worker.ts");
const pipeline = read("src/lib/document-intake/extraction/pipeline.ts");
const provider = read("src/lib/document-intake/extraction/provider.ts");
const statusRoute = read("src/app/api/document-intakes/[intakeId]/extraction/route.ts");
const cronRoute = read("src/app/api/cron/document-extractions/route.ts");

test("native PDF text is attempted before page rendering and OCR", () => {
  assert.ok(pipeline.indexOf("deps.extractNativePdfText") < pipeline.indexOf("deps.renderPdfPagesToPng"));
  assert.ok(pipeline.indexOf("native.usable") < pipeline.lastIndexOf("pagesFromOcr("));
  assert.match(pipeline, /OCR_PAGE_LIMIT_REACHED/);
  assert.match(pipeline, /PAGE_LIMIT_EXCEEDED/);
});

test("provider transmission is explicit, versioned, timed out, and retry bounded", () => {
  assert.match(provider, /DOCUMENT_OCR_ALLOW_THIRD_PARTY/);
  assert.match(provider, /DOCUMENT_OCR_HTTP_ENDPOINT/);
  assert.match(provider, /DOCUMENT_OCR_PROVIDER_VERSION/);
  assert.match(provider, /AbortSignal/);
  assert.match(pipeline, /providerAttempts/);
  assert.doesNotMatch(provider, /NEXT_PUBLIC_|EXPO_PUBLIC_/);
});

test("jobs are atomic, lease checked, idempotent, tenant scoped, and scan gated", () => {
  assert.match(migration, /for update of extraction skip locked/iu);
  assert.match(migration, /scan_status='clean'/u);
  assert.match(migration, /locked_by is distinct from p_worker_id/u);
  assert.match(migration, /action_scope='extract'/u);
  assert.match(migration, /business_id=p_business_id/u);
  assert.match(worker, /startsWith\(`\$\{job\.business_id\}\/\$\{job\.intake_id\}\/\$\{job\.evidence_id\}\//u);
});

test("raw results stay protected and client errors expose stable codes only", () => {
  assert.match(migration, /protected_raw_result jsonb/u);
  assert.match(migration, /revoke all on public\.document_intake_extractions from anon,authenticated/u);
  assert.doesNotMatch(statusRoute, /protected_raw_result|protected_raw_text|raw_text_object_path/u);
  assert.doesNotMatch(cronRoute, /error\.message/u);
  assert.doesNotMatch(statusRoute, /error\.message\s*[},]/u);
  assert.match(schema, /document_intake_complete_extraction/u);
  assert.match(rls, /revoke all on document_intake_extractions from anon,authenticated/u);
});

test("extraction always routes the intake to review or a safe failure and never writes financial records", () => {
  assert.match(migration, /status='needs_review'/u);
  assert.match(migration, /status='failed'/u);
  assert.doesNotMatch([migration, worker, pipeline].join("\n"), /insert into public\.(payments|obligations|cases|debtors)|update public\.(payments|obligations|cases|debtors)/iu);
});

test("result and retry access are authorised and cross-business scoped", () => {
  assert.match(statusRoute, /requireDocumentPermission\(request, "document_intake\.read"\)/u);
  assert.match(statusRoute, /requireDocumentPermission\(request, "document_intake\.create"\)/u);
  assert.match(statusRoute, /\.eq\("business_id", access\.businessId\)/u);
  assert.match(statusRoute, /document_intake_requeue_extraction/u);
});
