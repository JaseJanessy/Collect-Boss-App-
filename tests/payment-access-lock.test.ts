import assert from "node:assert/strict";
import test from "node:test";

type Lock = "immediate" | "approval" | "manual";
type Decision = "pending" | "approved" | "rejected";

function mayExpose(input: { lock: Lock; caseOpen: boolean; tokenActive: boolean; accountBound: boolean; request?: Decision; expired?: boolean }) {
  if (!input.caseOpen || !input.tokenActive || !input.accountBound || input.lock === "manual") return false;
  return input.lock === "immediate" || (input.request === "approved" && !input.expired);
}

test("immediate access requires an open case, active token, and bound account", () => {
  assert.equal(mayExpose({ lock: "immediate", caseOpen: true, tokenActive: true, accountBound: true }), true);
  assert.equal(mayExpose({ lock: "immediate", caseOpen: false, tokenActive: true, accountBound: true }), false);
});

test("approval access stays masked until the linked request is approved and unexpired", () => {
  assert.equal(mayExpose({ lock: "approval", caseOpen: true, tokenActive: true, accountBound: true, request: "pending" }), false);
  assert.equal(mayExpose({ lock: "approval", caseOpen: true, tokenActive: true, accountBound: true, request: "approved" }), true);
  assert.equal(mayExpose({ lock: "approval", caseOpen: true, tokenActive: true, accountBound: true, request: "approved", expired: true }), false);
});

test("manual, revoked, and account-replaced access is never disclosed", () => {
  assert.equal(mayExpose({ lock: "manual", caseOpen: true, tokenActive: true, accountBound: true }), false);
  assert.equal(mayExpose({ lock: "immediate", caseOpen: true, tokenActive: false, accountBound: true }), false);
  assert.equal(mayExpose({ lock: "immediate", caseOpen: true, tokenActive: true, accountBound: false }), false);
});
