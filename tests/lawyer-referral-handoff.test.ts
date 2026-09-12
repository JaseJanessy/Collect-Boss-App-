import assert from "node:assert/strict";
import test from "node:test";
import { canWithdrawReferral, isReferralEligible, LAWYER_REFERRAL_CONSENT_VERSION } from "../src/lib/lawyer-referrals/controlled-handoff.ts";

test("only open cases with a positive balance are eligible for legal-review requests", () => {
  assert.equal(isReferralEligible({ archivedAt: null, status: "overdue", balance: 1 }), true);
  assert.equal(isReferralEligible({ archivedAt: null, status: "closed", balance: 1 }), false);
  assert.equal(isReferralEligible({ archivedAt: "2026-07-18T00:00:00.000Z", status: "overdue", balance: 1 }), false);
  assert.equal(isReferralEligible({ archivedAt: null, status: "overdue", balance: 0 }), false);
});

test("withdrawal is unavailable after provider acceptance or terminal states", () => {
  assert.equal(canWithdrawReferral("ready_for_review"), true);
  assert.equal(canWithdrawReferral("handoff_failed"), true);
  assert.equal(canWithdrawReferral("additional_documents_requested"), true);
  assert.equal(canWithdrawReferral("accepted"), false);
  assert.equal(canWithdrawReferral("withdrawn"), false);
  assert.equal(LAWYER_REFERRAL_CONSENT_VERSION, "lawyer-referral-data-sharing-v1");
});
