import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("legacy routes and document types remain available", () => {
  for (const path of [
    "src/app/legal/[caseId]/demand/page.tsx",
    "src/app/legal/[caseId]/smallclaim/page.tsx",
    "src/app/evidence/[caseId]/pack/page.tsx",
    "src/app/api/cases/[caseId]/formal-demands/route.ts",
    "src/app/api/cases/[caseId]/formal-demands/[documentId]/route.ts",
    "src/app/api/cases/[caseId]/small-claim-packs/route.ts",
    "src/app/api/cases/[caseId]/small-claim-packs/[documentId]/route.ts",
  ]) assert.equal(statSync(path).isFile(), true, `${path} should remain available`);

  const noticeRoute = read("src/app/api/cases/[caseId]/formal-demands/route.ts");
  const readinessRoute = read("src/app/api/cases/[caseId]/small-claim-packs/route.ts");
  assert.match(noticeRoute, /document_type: `demand_\$\{input\.data\.tone\}`/);
  assert.match(readinessRoute, /document_type: "small_claim_pack"/);
});

test("active UI separates factual preparation from legal advice and authority", () => {
  const copy = [
    read("src/components/pages/legal/formal-demand-page.tsx"),
    read("src/components/pages/legal/small-claim-page.tsx"),
    read("src/components/pages/legal/documents-index-page.tsx"),
    read("src/components/pages/legal/evidence-pack-page.tsx"),
    read("src/components/pages/case-detail-page.tsx"),
    read("src/components/pages/landing-page.tsx"),
  ].join("\n");
  assert.match(copy, /Formal Payment Reminder/);
  assert.match(copy, /Final Payment Notice/);
  assert.match(copy, /Small Claim Readiness/);
  assert.match(copy, /Case Evidence Export/);
  assert.match(copy, /Request Legal Review/);
  assert.match(copy, /does not provide legal advice|not legal advice/i);
  assert.match(copy, /not a lawyer(?:'s)? demand|no lawyer or court authority|does not determine court eligibility/i);
  assert.doesNotMatch(copy, /our legal advisors for formal review and recovery proceedings|significantly increases legal standing/i);
});

test("new generated outputs are versioned and historical rendering remains explicit", () => {
  const noticeTemplate = read("src/lib/formal-demands/template.ts");
  const noticePdf = read("src/lib/pdf/demand-generator.ts");
  const readinessTemplate = read("src/lib/small-claims/template.ts");
  const readinessPdf = read("src/lib/pdf/small-claim-generator.ts");
  assert.match(noticeTemplate, /FORMAL_DEMAND_TEMPLATE_VERSION = 2/);
  assert.match(noticeTemplate, /legacyTemplate/);
  assert.match(noticePdf, /templateVersion \?\? 1/);
  assert.match(readinessTemplate, /SMALL_CLAIM_TEMPLATE_VERSION = 3/);
  assert.match(readinessTemplate, /snapshot\.templateVersion < 3/);
  assert.match(readinessPdf, /data\.templateVersion \?\? 2/);
});

test("legal-adjacent APIs retain authenticated tenant scoping", () => {
  const routes = [
    read("src/app/api/cases/[caseId]/formal-demands/route.ts"),
    read("src/app/api/cases/[caseId]/formal-demands/[documentId]/route.ts"),
    read("src/app/api/cases/[caseId]/small-claim-packs/route.ts"),
    read("src/app/api/cases/[caseId]/small-claim-packs/[documentId]/route.ts"),
    read("src/app/api/cases/[caseId]/evidence-pack/route.ts"),
  ];
  for (const route of routes) {
    assert.match(route, /getAuthenticatedBusiness/);
    assert.match(route, /auth\.businessId/);
  }
});
