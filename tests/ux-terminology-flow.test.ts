import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

test("product glossary covers every approved domain concept and its audience exception", () => {
  const glossary = read("docs/PRODUCT_GLOSSARY.md");
  for (const concept of [
    "debtor", "customer", "case", "receivable", "invoice", "payment proof", "receipt",
    "promise-to-pay", "payment plan", "dispute", "settlement", "closure", "formal demand", "legal handoff",
  ]) assert.match(glossary.toLowerCase(), new RegExp(`\\| ${concept.replace("-", "-")} \\|`));
  assert.match(glossary, /Customer.*relationship/i);
  assert.match(glossary, /Debtor.*recovery/i);
});

test("development standard references executable labels and confirmation rules", () => {
  const standard = read("docs/UX_DEVELOPMENT_STANDARD.md");
  assert.match(standard, /PRODUCT_GLOSSARY\.md/);
  assert.match(standard, /Irreversible or materially consequential actions require a confirmation/i);
  assert.match(standard, /hiding a button is not an access or workflow control/i);
});

test("transition contracts gate both UI and privileged API paths", () => {
  const caseApi = read("src/app/api/cases/[caseId]/route.ts");
  const disputeApi = read("src/app/api/cases/[caseId]/disputes/[disputeId]/route.ts");
  const paymentApi = read("src/app/api/payments/[id]/review/route.ts");
  const promiseUi = read("src/components/cases/payment-promise-card.tsx");
  assert.match(caseApi, /canTransitionCase/);
  assert.match(disputeApi, /canTransitionDispute/);
  assert.match(paymentApi, /canTransitionPayment/);
  assert.match(promiseUi, /canTransitionPromise/);
});

test("critical closure, promise and dispute actions state their consequences", () => {
  assert.match(read("src/components/cases/financial-adjustments-card.tsx"), /Closing ends recovery work.*does not delete case data/s);
  assert.match(read("src/components/cases/payment-promise-card.tsx"), /stop future matching.*remain in the case activity/s);
  assert.match(read("src/components/cases/dispute-card.tsx"), /decision and response will be recorded in case activity/s);
});
