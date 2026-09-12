import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path: string) => fs.readFileSync(path, "utf8");
const server = read("src/lib/timeline/server.ts");
const model = read("src/lib/timeline/model.ts");
const staffRoute = read("src/app/api/cases/[caseId]/timeline/route.ts");
const customerRoute = read("src/app/api/public/pay/[token]/timeline/route.ts");
const component = read("src/components/cases/unified-case-timeline.tsx");
const casePage = read("src/components/pages/case-detail-page.tsx");
const statementRoute = read("src/app/api/statements/pdf/route.ts");

test("unified timeline derives the required history from existing source records", () => {
  for (const source of [
    "cases", "case_status_history", "reminders", "communication_activities",
    "payment_promise_events", "dispute_events", "payment_negotiation_events",
    "payment_plans", "payment_plan_events", "payment_proof_events",
    "case_financial_events", "evidence_files", "legal_documents",
    "lawyer_referral_events", "audit_logs",
  ]) assert.match(server, new RegExp(`from\\(\"${source}\"\\)`));
  for (const type of ["case.created", "invoice.overdue", "case.closed", "statement.generated"]) {
    assert.match(server, new RegExp(type.replace(".", "\\.")));
  }
});

test("event layer uses deterministic source references rather than a duplicated event table", () => {
  assert.match(model, /source_record: \{ table: string; id: string \}/);
  assert.match(model, /deduplicated = new Map/);
  assert.doesNotMatch(server, /\.insert\(/);
  assert.match(server, /reminderCommunicationIds/);
});

test("visibility is enforced server-side for tokenized debtor access", () => {
  assert.match(customerRoute, /getPublicActionContext\(token, "payment"\)/);
  assert.match(customerRoute, /loadCaseTimeline\(service, access\.caseScope\.id, access\.caseScope\.business_id, "customer"\)/);
  assert.match(model, /audience === "customer" && source\.visibility !== "customer_visible"/);
  assert.doesNotMatch(customerRoute, /internal_reason|transition_reason|notes/);
  assert.match(staffRoute, /getAuthenticatedBusiness/);
});

test("case page renders one timeline with all required filters", () => {
  assert.match(casePage, /UnifiedCaseTimeline/);
  for (const label of ["All", "Communication", "Payments", "Promises", "Documents", "Case Changes"]) {
    assert.match(component, new RegExp(`label: "${label}"`));
  }
});

test("generated statements append source audit references per case", () => {
  assert.match(statementRoute, /action: "statement\.generated"/);
  assert.match(statementRoute, /case_id: caseId/);
  assert.match(statementRoute, /audit_logs/);
});
