import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  caseWorkspaceSections,
  resolveCaseWorkspaceSection,
} from "../src/lib/cases/workspace.ts";

const read = (path: string) => readFileSync(path, "utf8");

test("case workspace has seven non-overlapping authoritative sections", () => {
  assert.deepEqual(caseWorkspaceSections.map((section) => section.label), [
    "Overview", "Financials", "Communications", "Resolution", "Evidence", "Legal", "Activity",
  ]);
  assert.equal(new Set(caseWorkspaceSections.map((section) => section.id)).size, 7);
  assert.equal(resolveCaseWorkspaceSection(null, "payments"), "financials");
  assert.equal(resolveCaseWorkspaceSection(null, "documents"), "legal");
  assert.equal(resolveCaseWorkspaceSection(null, "timeline"), "activity");
});

test("case workspace defers section data and preserves visited section state", () => {
  const page = read("src/components/pages/case-detail-page.tsx");
  assert.match(page, /visitedSections/);
  assert.match(page, /sectionEnabled\("financials"\)/);
  assert.match(page, /sectionEnabled\("communications"\)/);
  assert.match(page, /sectionEnabled\("resolution"\)/);
  assert.match(page, /sectionEnabled\("evidence"\)/);
  assert.match(page, /sectionEnabled\("legal"\)/);
  assert.match(page, /sectionEnabled\("activity"\)/);
  assert.match(page, /window\.history\.pushState/);
});

test("case mutation APIs enforce the section permission model", () => {
  const expectations = new Map([
    ["src/app/api/cases/[caseId]/evidence/route.ts", /write \? "case\.manage" : "case\.read"/],
    ["src/app/api/cases/[caseId]/evidence/[evidenceId]/route.ts", /write \? "case\.manage" : "case\.read"/],
    ["src/app/api/cases/[caseId]/disputes/route.ts", /write \? "dispute\.resolve" : "case\.read"/],
    ["src/app/api/cases/[caseId]/formal-demands/route.ts", /getAuthenticatedBusiness\("case\.manage"\)/],
    ["src/app/api/cases/[caseId]/small-claim-packs/route.ts", /getAuthenticatedBusiness\("case\.manage"\)/],
    ["src/app/api/cases/[caseId]/evidence-pack/route.ts", /getAuthenticatedBusiness\("case\.manage"\)/],
    ["src/app/api/cases/[caseId]/payment-plans/route.ts", /getAuthenticatedBusiness\("promise\.manage"\)/],
  ]);
  for (const [path, pattern] of expectations) assert.match(read(path), pattern, path);
  const handoff = read("src/app/api/cases/[caseId]/lawyer-referrals/route.ts");
  assert.equal((handoff.match(/getAuthenticatedBusiness\("case\.manage"\)/g) ?? []).length, 2);
});

test("organisation-wide queues remain outside the case workspace", () => {
  const map = read("docs/CASE_WORKSPACE_MAP.md");
  for (const globalDestination of ["Action Centre", "reports", "billing", "audit administration"]) {
    assert.match(map, new RegExp(globalDestination, "i"));
  }
});
