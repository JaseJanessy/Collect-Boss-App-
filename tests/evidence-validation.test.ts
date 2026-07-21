import assert from "node:assert/strict";
import test from "node:test";
import { MAX_EVIDENCE_FILE_BYTES, createEvidenceObjectPath, validateEvidenceUpload } from "../src/lib/evidence/validation.ts";

test("accepts verified PDF and creates a non-overwritable server path", () => {
  const file = new File(["%PDF-1.7\nexample"], "invoice.pdf", { type: "application/pdf" });
  const result = validateEvidenceUpload(file, new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]));
  assert.equal("error" in result, false);
  const first = createEvidenceObjectPath("business-a", "CB-2026-1", "pdf");
  const second = createEvidenceObjectPath("business-a", "CB-2026-1", "pdf");
  assert.match(first, /^business-a\/CB-2026-1\/[0-9a-f-]+\.pdf$/);
  assert.notEqual(first, second);
});

test("rejects unsupported MIME, mismatched signatures, and oversized payloads", () => {
  const image = new File(["not an image"], "evidence.png", { type: "image/png" });
  assert.match((validateEvidenceUpload(image, new Uint8Array([1, 2, 3])) as { error: string }).error, /contents/);
  const text = new File(["text"], "notes.txt", { type: "text/plain" });
  assert.match((validateEvidenceUpload(text, new Uint8Array([1])) as { error: string }).error, /Only PDF/);
  const large = new File([new Uint8Array(MAX_EVIDENCE_FILE_BYTES + 1)], "large.pdf", { type: "application/pdf" });
  assert.match((validateEvidenceUpload(large, new Uint8Array([37, 80, 68, 70, 45])) as { error: string }).error, /10 MB/);
});
