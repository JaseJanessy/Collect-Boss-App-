import assert from "node:assert/strict";
import test from "node:test";
import { buildEvidencePackManifest, validateEvidencePackSelection } from "../src/lib/evidence/pack.ts";
import { generateEvidencePackPdf, type EvidencePackData } from "../src/lib/pdf/evidence-pack-generator.ts";
import type { EvidenceFileRow } from "../src/lib/supabase/types.ts";

function file(id: string, name: string, uploadedAt: string, bytes = 1024): EvidenceFileRow {
  return {
    id, case_id: "case-1", business_id: "business-1", intake_id: null,
    file_name: name, file_type: "PDF", file_url: null, file_size_bytes: bytes,
    evidence_type: "invoice", uploaded_at: uploadedAt, object_path: "private/path", description: null,
    document_date: null, is_internal: true, archived_at: null, archived_by: null, retention_until: null,
    content_sha256: "a".repeat(64),
    page_count: 1, evidence_version: 1, is_current: true, scan_status: "clean",
    processing_status: "completed", duplicate_match_status: "none", soft_deleted_at: null,
  };
}

test("manifest sorts records and removes traversal from display filenames", () => {
  const manifest = buildEvidencePackManifest("case-1", [
    file("b", "../secret.pdf", "2026-07-18T01:00:00.000Z"),
    file("a", "report.pdf", "2026-07-18T00:00:00.000Z"),
  ], "2026-07-18T02:00:00.000Z");
  assert.deepEqual(manifest.files.map((entry) => entry.evidenceId), ["a", "b"]);
  assert.equal(manifest.files[1].filename, "_secret.pdf");
  assert.equal(JSON.stringify(manifest).includes("private/path"), false);
});

test("pack selection caps aggregate declared evidence size", () => {
  assert.equal(validateEvidencePackSelection([file("a", "a.pdf", "2026-07-18T00:00:00.000Z", 51 * 1024 * 1024)]), "Selected evidence exceeds the 50 MB pack limit.");
});

test("PDF generation emits a PDF for a deterministic manifest", async () => {
  const data: EvidencePackData = {
    caseId: "case-1", businessName: "Example", debtorName: "Debtor", debtorCompany: null, debtorRegNo: null,
    debtorPhone: null, debtorEmail: null, debtorLocation: null, amountOwed: 100, amountPaid: 0, balance: 100,
    dueDate: "2026-07-01", invoiceNo: null, daysOverdue: 1, status: "overdue", paymentLockMode: "manual",
    reminders: [], payments: [], evidenceFiles: [{ evidence_id: "a", file_name: "report.pdf", file_type: "PDF", evidence_type: "invoice", file_size_bytes: 1024, uploaded_at: "2026-07-18T00:00:00.000Z", content_sha256: "a".repeat(64) }],
    uploadedEvidenceTypes: ["invoice"], missingMustHave: ["WhatsApp / Chat Screenshot", "Payment Proof"], evidenceScore: 17,
    activePlan: null, timeline: [], hasAcknowledgement: false, generatedAt: "2026-07-18T02:00:00.000Z",
  };
  const pdf = await generateEvidencePackPdf(data);
  const bytes = new Uint8Array(await pdf.arrayBuffer());
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
});
