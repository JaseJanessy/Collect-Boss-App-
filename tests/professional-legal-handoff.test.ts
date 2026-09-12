import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildProfessionalHandoffPackage, LEGAL_HANDOFF_DISCLAIMER } from "../src/lib/lawyer-referrals/package.ts";
import type { BusinessRow, CaseRow, EvidenceFileRow, LegalDocumentRow } from "../src/lib/supabase/types.ts";

const read = (path: string) => readFileSync(path, "utf8");
const record = (value: unknown): Record<string, unknown> => {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
  return value as Record<string, unknown>;
};

test("professional handoff package reconciles and contains only selected case metadata", () => {
  const packageSnapshot = record(buildProfessionalHandoffPackage({
    caseData: {
      id: "case-1", business_id: "business-1", debtor_id: "debtor-1", debtor_type: "business",
      debtor_name: "Example Customer", debtor_phone: null, debtor_email: null, debtor_company: "Example Trading",
      debtor_reg_no: "REG-1", debtor_location: "Kuala Lumpur", amount_owed: 100, amount_paid: 25, balance: 75,
      original_principal_minor: 10_000, contractual_due_minor: 10_000, approved_payment_minor: 2_000,
      outstanding_minor: 7_500, overpayment_minor: 0, financial_version: 1, due_date: "2026-01-31",
      invoice_no: "INV-1", status: "overdue", promise_due_date: null, closed_at: null, closed_by: null,
      close_reason: null, archived_at: null, archived_by: null, archive_reason: null, status_version: 1,
      next_best_action: null, payment_lock_mode: "manual", receiving_account_id: null, days_overdue: 20,
      notes: "INTERNAL NOTE MUST NOT LEAK", bank: null, created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-02-01T00:00:00.000Z",
    } as CaseRow,
    business: {
      id: "business-1", owner_id: "owner-1", business_name: "Creditor", registration_no: "CO-1",
      account_type: "business", legal_name: "Creditor Sdn Bhd", contact_name: "Owner", logo_object_path: null,
      phone: "+600000000", email: "owner@example.test", address: null, created_at: "2025-01-01T00:00:00.000Z",
    } as BusinessRow,
    evidence: [{
      id: "evidence-1", case_id: "case-1", file_name: "invoice.pdf", file_type: "PDF",
      file_url: "https://private.example.test/must-not-leak", file_size_bytes: 10, evidence_type: "invoice",
      uploaded_at: "2026-01-02T00:00:00.000Z", object_path: "private/must-not-leak", description: null,
      document_date: "2026-01-01", is_internal: false, archived_at: null, archived_by: null,
      retention_until: null, content_sha256: "abc",
    } as EvidenceFileRow],
    documents: [{
      id: "document-1", document_type: "formal_demand", title: "Formal demand", status: "issued",
      document_number: "DOC-1", template_version: 1, issued_at: "2026-01-10T00:00:00.000Z",
    } as unknown as LegalDocumentRow],
    financialEvents: [
      { id: "payment-1", event_type: "payment_approved", amount_minor: 2_000, created_at: "2026-01-15T00:00:00.000Z" },
      { id: "credit-1", event_type: "adjustment_credit", amount_minor: 500, created_at: "2026-01-20T00:00:00.000Z" },
    ],
    statusHistory: [], reminders: [], payments: [], createdAt: "2026-02-01T00:00:00.000Z",
  }));

  const statement = record(packageSnapshot.statement);
  assert.equal(Number(statement.opening_balance_minor) + Number(statement.movement_minor), Number(statement.closing_balance_minor));
  assert.equal(statement.closing_balance_minor, "7500");
  assert.match(String(packageSnapshot.disclaimer), /does not provide legal advice/i);
  const serialized = JSON.stringify(packageSnapshot);
  assert.match(serialized, /evidence-1/);
  assert.match(serialized, /document-1/);
  assert.doesNotMatch(serialized, /INTERNAL NOTE MUST NOT LEAK|private\.example\.test|private\/must-not-leak/);
  assert.equal(LEGAL_HANDOFF_DISCLAIMER.includes("does not provide legal advice"), true);
});

test("migration enforces tenant controls, idempotency, audit and document-request notifications", () => {
  const migration = read("supabase/migrations/20260808_professional_legal_handoff.sql");
  assert.match(migration, /additional_documents_requested/);
  assert.match(migration, /legal_handoff_document_requests/);
  assert.match(migration, /legal_handoff_document_request_evidence/);
  assert.match(migration, /unique index[\s\S]*idempotency_key/i);
  assert.match(migration, /auth\.uid\(\)[\s\S]*businesses[\s\S]*owner_id/i);
  assert.match(migration, /e\.case_id = v_request\.case_id/i);
  assert.match(migration, /v_referral\.business_id <> v_request\.business_id/i);
  assert.match(migration, /lawyer_contacted[\s\S]*additional_documents_requested[\s\S]*accepted[\s\S]*closed/i);
  assert.match(migration, /insert into public\.notifications/i);
  assert.match(migration, /insert into public\.action_centre_items/i);
  assert.match(migration, /insert into public\.audit_logs/i);
  assert.match(migration, /actor_type[\s\S]*professional/i);
  assert.doesNotMatch(migration, /delete from public\.lawyer_referrals/i);
});

test("professional callback and owner response retain authentication and tenant boundaries", () => {
  const callbackRoute = read("src/app/api/legal-handoffs/[referralId]/professional-updates/route.ts");
  const responseRoute = read("src/app/api/legal-handoffs/[referralId]/document-requests/[requestId]/route.ts");
  const handoffRoute = read("src/app/api/cases/[caseId]/lawyer-referrals/route.ts");
  assert.match(callbackRoute, /LEGAL_HANDOFF_WEBHOOK_SECRET/);
  assert.match(callbackRoute, /timingSafeEqual/);
  assert.match(callbackRoute, /professionalName/);
  assert.match(responseRoute, /getAuthenticatedBusiness/);
  assert.match(responseRoute, /\.eq\("business_id", auth\.businessId\)/);
  assert.match(handoffRoute, /\.eq\("business_id", auth\.businessId\)/);
});

test("active product copy describes external professional review without commissions", () => {
  const activeCopy = [
    read("src/components/pages/legal/controlled-lawyer-referral-page.tsx"),
    read("src/components/pages/legal/documents-index-page.tsx"),
    read("src/components/pages/case-detail-page.tsx"),
  ].join("\n");
  assert.match(activeCopy, /Professional Legal Handoff/);
  assert.match(activeCopy, /Request Legal Review/);
  assert.match(activeCopy, /does not provide legal advice/i);
  assert.doesNotMatch(activeCopy, /referral commission|fee[- ]sharing|commission fee/i);
});
