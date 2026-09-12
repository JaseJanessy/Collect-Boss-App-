import { describe, expect, it } from "vitest";
import {
  approvalSatisfies,
  evaluateCompliancePolicy,
  hashComplianceContent,
  MALAYSIA_DRAFT_POLICY_RULES,
} from "@/lib/compliance/policy-engine";
import type { ComplianceEvaluationInput, CompliancePolicyVersion } from "@/lib/compliance/types";

const policy: CompliancePolicyVersion = {
  id: "00000000-0000-4000-8000-000000000020",
  jurisdiction: "MY",
  version: "test-counsel-approved-1",
  status: "counsel_approved",
  effective_from: "2026-01-01T00:00:00.000Z",
  effective_until: null,
  rules: MALAYSIA_DRAFT_POLICY_RULES,
};

function input(overrides: Partial<ComplianceEvaluationInput> = {}): ComplianceEvaluationInput {
  return {
    caseId: "CB-2026-20",
    channel: "email",
    subject: "Account update",
    bodyText: "Please contact us to discuss the account.",
    recipients: ["customer@example.test"],
    timezone: "Asia/Kuala_Lumpur",
    now: new Date("2026-08-12T04:00:00.000Z"),
    counts: { attempts_24h: 0, attempts_7d: 0, attempts_30d: 0 },
    preferences: null,
    confirmedOutstandingMinor: 50_000,
    unverifiedBalanceMinor: 0,
    ...overrides,
  };
}

describe("compliance policy engine", () => {
  it("evaluates configured contact windows in the case timezone", () => {
    expect(evaluateCompliancePolicy(policy, input()).required_approval).toBe("automatic");
    const outside = evaluateCompliancePolicy(policy, input({ timezone: "America/New_York" }));
    expect(outside.required_approval).toBe("agent");
    expect(outside.signals).toContain("outside_contact_window");
  });

  it("escalates rolling frequency limits to supervisor approval", () => {
    const result = evaluateCompliancePolicy(policy, input({
      counts: { attempts_24h: 2, attempts_7d: 4, attempts_30d: 8 },
    }));
    expect(result.result).toBe("approval_required");
    expect(result.required_approval).toBe("supervisor");
    expect(result.signals).toContain("frequency_24_hours");
  });

  it("prohibits threats, authority impersonation, third-party disclosure, and unverified amount references", () => {
    for (const bodyText of [
      "Pay or else.",
      "We are the court and demand payment.",
      "We will inform your employer of this debt.",
    ]) {
      expect(evaluateCompliancePolicy(policy, input({ bodyText })).result).toBe("prohibited");
    }
    const unverified = evaluateCompliancePolicy(policy, input({
      bodyText: "Your outstanding balance is MYR 500.",
      unverifiedBalanceMinor: 50_000,
    }));
    expect(unverified.result).toBe("prohibited");
    expect(unverified.signals).toContain("unverified_amount_reference");
  });

  it("pauses automation for all required sensitive-case categories", () => {
    const examples = [
      "This was identity theft.", "I paid in full.", "Contact my solicitor.",
      "I am making a formal complaint.", "I have a medical emergency.",
      "The customer passed away.", "You contacted the wrong person.",
    ];
    const categories = examples.flatMap((bodyText) => evaluateCompliancePolicy(policy, input({ bodyText })).sensitive_case_triggers);
    expect(new Set(categories)).toEqual(new Set([
      "identity_theft", "paid_in_full_dispute", "legal_representation", "serious_complaint",
      "vulnerability", "bereavement", "wrong_party",
    ]));
  });

  it("binds approval to normalized content and recipients", () => {
    const original = hashComplianceContent({ caseId: "CB-1", channel: "email", subject: "Hello", bodyText: "Pay RM 10", recipients: ["A@EXAMPLE.TEST"] });
    const normalized = hashComplianceContent({ caseId: "CB-1", channel: "email", subject: "Hello ", bodyText: "Pay RM 10", recipients: ["a@example.test"] });
    const edited = hashComplianceContent({ caseId: "CB-1", channel: "email", subject: "Hello", bodyText: "Pay RM 11", recipients: ["a@example.test"] });
    expect(normalized).toBe(original);
    expect(edited).not.toBe(original);
  });

  it("does not permit prohibited decisions to be satisfied by any approval level", () => {
    expect(approvalSatisfies("supervisor", "legal")).toBe(true);
    expect(approvalSatisfies("legal", "supervisor")).toBe(false);
    expect(approvalSatisfies("prohibited", "legal")).toBe(false);
  });
});
