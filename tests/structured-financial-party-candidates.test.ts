import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/20260904_structured_financial_party_candidates.sql");
const route = read("src/app/api/document-intakes/[intakeId]/extraction/route.ts");
const parser = read("src/lib/document-intake/extraction/classifier.ts");
const worker = read("src/lib/document-intake/extraction/worker.ts");

test("candidate rows retain complete provenance and remain separate from approved records", () => {
  for (const column of ["extraction_id", "evidence_id", "document_version", "original_text", "normalized_value",
    "confidence", "extraction_method", "provider_version", "parser_version", "source_page", "source_bounding_box", "source_text_span"]) {
    assert.match(migration, new RegExp(column));
  }
  assert.match(migration, /document_extraction_candidates_immutable/u);
  assert.doesNotMatch([migration, parser, worker].join("\n"), /insert into public\.(payments|obligations|cases|debtors)|update public\.(payments|obligations|cases|debtors)/iu);
});

test("re-extraction creates immutable versions instead of replacing approved or prior results", () => {
  assert.match(migration, /max\(extraction_version\).*\+1/isu);
  assert.match(migration, /document_intake_extractions_evidence_version_uidx/u);
  assert.doesNotMatch(migration, /update public\.document_intake_extractions set status='queued'/u);
});

test("candidate access is tenant scoped, permission checked and role masked", () => {
  assert.match(route, /requireDocumentPermission\(request, "document_intake\.read"\)/u);
  assert.match(route, /\.eq\("business_id", access\.businessId\)/u);
  assert.match(route, /canViewSensitive/u);
  assert.match(route, /Sensitive identifier masked/u);
  assert.match(migration, /revoke all on public\.document_extraction_candidates from public,anon,authenticated/u);
  assert.match(migration, /created_at>now\(\)-interval '1 hour'/u);
  assert.match(migration, /p_business_id::text\|\|':extract-rate'/u);
  assert.match(read("src/lib/document-intake/api.ts"), /P12_EXTRACTION_RATE_LIMITED[\s\S]*429/u);
});

test("deterministic validation precedes any provider inference and covers required rules", () => {
  assert.match(parser, /parseLocaleMoney/u);
  assert.match(parser, /normalizeDate/u);
  for (const flag of ["IMPOSSIBLE_DATE", "MALFORMED_CURRENCY", "DUPLICATE_INVOICE_IDENTIFIER", "TOTAL_DOES_NOT_RECONCILE"]) {
    assert.match(parser + migration, new RegExp(flag));
  }
  assert.match(worker, /p_candidates: output\.result\.field_candidates/u);
});
