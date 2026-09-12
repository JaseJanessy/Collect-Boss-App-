import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/20260910_compliance_guardrails_approval_gates.sql");
const communicationApi = read("src/app/api/cases/[caseId]/communications/route.ts");
const emailApi = read("src/app/api/cases/[caseId]/email/route.ts");
const emailService = read("src/lib/email/service.ts");
const decisionApi = read("src/app/api/compliance/checks/[checkId]/decision/route.ts");

describe("compliance guardrail integration contract", () => {
  it("keeps the Malaysia pack draft and requires documented counsel validation before activation", () => {
    expect(migration).toMatch(/'MY','MY-DRAFT-2026-01','draft'/);
    expect(migration).toMatch(/status<>'counsel_approved'[\s\S]*counsel_validated_at is not null[\s\S]*counsel_validation_reference/);
    expect(migration).toContain("does not guarantee compliance");
  });

  it("rejects direct outbound persistence without a valid policy check", () => {
    expect(migration).toMatch(/compliance_communication_execution_guard/);
    expect(migration).toMatch(/COMPLIANCE_CHECK_REQUIRED/);
    expect(migration).toMatch(/COMPLIANCE_CHECK_MISMATCH/);
    expect(migration).toMatch(/COMPLIANCE_POLICY_NOT_ACTIVE/);
    expect(migration).toMatch(/COMPLIANCE_CASE_PAUSED/);
    expect(communicationApi).toContain('rpc("compliance_communication_activity_create"');
    expect(communicationApi).toContain("requireExecutableComplianceCheck");
  });

  it("gates immediate, scheduled, worker, and bulk email paths", () => {
    expect(emailApi).toContain("requireExecutableComplianceCheck");
    expect(emailApi).toContain("policy_content_hash");
    expect(emailService).toContain("requireExecutableComplianceCheck");
    expect(emailService).toContain("policyCheckId: row.policy_check_id");
    expect(migration).toContain("compliance_scheduled_email_guard");
  });

  it("makes bypasses permission-controlled, reason-required, non-prohibited, and audited", () => {
    expect(decisionApi).toContain('"compliance.bypass"');
    expect(decisionApi).toMatch(/note: z\.string\(\)\.trim\(\)\.min\(10\)/);
    expect(read("src/lib/compliance/service.ts")).toContain("PROHIBITED_BYPASS_DENIED");
    expect(read("src/lib/compliance/service.ts")).toContain('"compliance.bypassed"');
  });

  it("creates an owned review task and a database-enforced pause for paid-in-full disputes", () => {
    expect(migration).toContain("compliance_pause_paid_in_full_dispute");
    expect(migration).toContain("compliance.sensitive_review");
    expect(migration).toMatch(/paid_in_full_dispute[\s\S]*automation_paused/);
  });

  it("records policy version, result, warnings, approver, and final action in the audit trail", () => {
    for (const field of ["policy_version_id", "result", "warnings", "approver", "final_action"]) {
      expect(migration).toContain(`'${field}'`);
    }
  });
});
