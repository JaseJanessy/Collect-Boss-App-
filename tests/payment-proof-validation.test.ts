import assert from "node:assert/strict";
import test from "node:test";
import { validatePaymentDate, validatePaymentProof } from "../src/lib/public-access/proof-validation.ts";

test("accepts a matching PDF signature and produces a deterministic SHA-256", async () => {
  const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])], "proof.pdf", { type: "application/pdf" });
  const proof = await validatePaymentProof(file);
  assert.equal(proof.extension, "pdf");
  assert.match(proof.sha256, /^[0-9a-f]{64}$/);
});

test("rejects an executable payload presented as a PDF", async () => {
  const file = new File([new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03])], "proof.pdf", { type: "application/pdf" });
  await assert.rejects(() => validatePaymentProof(file), /does not match/);
});

test("rejects future and malformed payment dates", () => {
  assert.equal(validatePaymentDate("2026-07-16"), "2026-07-16");
  assert.throws(() => validatePaymentDate("not-a-date"), /valid payment date/);
  assert.throws(() => validatePaymentDate("2099-01-01"), /valid payment date/);
});
