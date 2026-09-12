import { describe, expect, it } from "vitest";
import { canTransitionDocumentIntake } from "@/lib/document-intake/status";
import {
  documentEvidenceObjectPath,
  readIdempotencyKey,
  validateDocumentUpload,
} from "@/lib/document-intake/validation";

describe("document intake validation and status model", () => {
  it("rejects direct submission and keeps terminal states terminal", () => {
    expect(canTransitionDocumentIntake("draft", "submitted")).toBe(false);
    expect(canTransitionDocumentIntake("draft", "awaiting_upload")).toBe(true);
    expect(canTransitionDocumentIntake("ready_to_submit", "submitted")).toBe(true);
    expect(canTransitionDocumentIntake("submitted", "needs_review")).toBe(false);
    expect(canTransitionDocumentIntake("cancelled", "draft")).toBe(false);
  });

  it("uses a server-generated tenant/intake/evidence path without the original name", () => {
    const path = documentEvidenceObjectPath({
      businessId: "11111111-1111-4111-8111-111111111111",
      intakeId: "22222222-2222-4222-8222-222222222222",
      evidenceId: "33333333-3333-4333-8333-333333333333",
      extension: "pdf",
    });
    expect(path.objectPath).toBe("11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/original.pdf");
    expect(path.objectPath).not.toContain("customer-invoice");
  });

  it("accepts matching PDF magic bytes and rejects declared/magic MIME mismatch", () => {
    const prefix = "%PDF-1.7\n1 0 obj\n<< /Type /Page >>\nendobj\n";
    const pdfBytes = new TextEncoder().encode(`${prefix}xref\n0 1\n0000000000 65535 f \ntrailer\n<<>>\nstartxref\n${prefix.length}\n%%EOF`);
    const pdf = new File([pdfBytes], "customer-invoice.pdf", { type: "application/pdf" });
    const accepted = validateDocumentUpload(pdf, pdfBytes);
    expect("error" in accepted).toBe(false);
    if (!("error" in accepted)) expect(accepted.sha256).toMatch(/^[0-9a-f]{64}$/);

    const disguised = new File([pdfBytes], "image.png", { type: "image/png" });
    expect(validateDocumentUpload(disguised, pdfBytes)).toMatchObject({ code: "PDF_ONLY" });
  });

  it("requires a bounded idempotency key", () => {
    expect(readIdempotencyKey(new Headers())).toMatchObject({ code: "INVALID_IDEMPOTENCY_KEY" });
    expect(readIdempotencyKey(new Headers({ "Idempotency-Key": "upload:request-123" }))).toEqual({ key: "upload:request-123" });
  });
});
