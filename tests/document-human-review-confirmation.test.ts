import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/20260905_human_review_evidence_confirmation.sql");
const foundation = read("supabase/migrations/20260831_secure_document_intake_foundation.sql");
const reviewRoute = read("src/app/api/document-intakes/[intakeId]/review/route.ts");
const finaliseRoute = read("src/app/api/document-intakes/[intakeId]/route.ts");
const reviewDomain = read("src/lib/document-intake/review.ts");
const mobileReview = read("mobile/src/components/transaction-review.tsx");

test("draft saves cannot silently become ready and finalise requires a confirmed current extraction", () => {
  assert.match(migration, /case when p_action='confirm' then 'ready_to_submit' else 'needs_review' end/u);
  assert.match(migration, /v_confirmation\.review_status<>'confirmed'/u);
  assert.match(migration, /extraction\.evidence_id=evidence\.id/u);
  assert.match(migration, /update public\.document_intake_confirmations set review_status='draft'/u);
  assert.doesNotMatch(finaliseRoute, /rpc\("document_intake_confirm"/u);
});

test("the server resolves tenant, business currency, extraction, candidate, actor, and evidence", () => {
  assert.match(reviewRoute, /requireDocumentPermission\(request, "document_intake\.create"\)/u);
  assert.match(reviewRoute, /supportedCurrencies: \[data\.business\.default_currency\.toUpperCase\(\)\]/u);
  assert.match(reviewRoute, /p_business_id: access\.businessId/u);
  assert.match(reviewRoute, /p_actor_id: access\.user\.id/u);
  assert.match(migration, /v_candidate:=v_extraction\.structured_result->'amount_candidates'->v_candidate_index/u);
  assert.match(migration, /p_review->'evidence_citations'/u);
});

test("amount ranking excludes balance, fee, limit and total debit from automatic recommendation", () => {
  assert.match(reviewDomain, /discouragedAmountLabels/u);
  for (const label of ["available_balance", "daily_limit", "fee", "total_debit"]) assert.match(reviewDomain, new RegExp(`"${label}"`));
  assert.doesNotMatch(reviewDomain, /sort\([^)]*minorUnits/u);
});

test("audit records proposals, corrections, citations, confirmer and timestamp", () => {
  for (const value of ["original_candidates_and_corrections", "evidence_citations", "reviewed_at", "reviewed_by"]) assert.match(migration, new RegExp(value));
  assert.match(migration, /document_review\.confirmed/u);
  assert.match(foundation, /document_intake_confirmations_append_only_guard/u);
});

test("mobile review is results-first, accessible, and keeps advanced fields behind Edit", () => {
  assert.match(mobileReview, /AI extracted · not bank verified/u);
  assert.match(mobileReview, /Recommended candidate only/u);
  assert.match(mobileReview, /accessibilityRole="radio"/u);
  assert.match(mobileReview, /accessibilityRole="alert"/u);
  assert.match(mobileReview, /accessibilityViewIsModal/u);
  assert.match(mobileReview, /Save Draft/u);
  assert.match(mobileReview, /Retry Extraction/u);
  assert.match(mobileReview, /Enter Manually/u);
  assert.match(mobileReview, /Continue/u);
  assert.match(mobileReview, /editAll/u);
});

test("review confirmation never writes an official financial or identity record", () => {
  const sqlWithoutComments = migration.replace(/--.*$/gmu, "");
  assert.doesNotMatch(sqlWithoutComments, /(?:insert into|update) public\.(?:payments|obligations|cases|debtors|case_financial_events)/iu);
  assert.doesNotMatch([reviewRoute, reviewDomain].join("\n"), /\.from\("(?:payments|obligations|cases|debtors|case_financial_events)"\)/u);
});
