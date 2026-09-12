import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildStructuredExtraction } from "@/lib/document-intake/extraction/classifier";
import { extractDocument, ExtractionPipelineError } from "@/lib/document-intake/extraction/pipeline";
import type { ExtractedPage, OcrProvider } from "@/lib/document-intake/extraction/types";

const page = (text: string, pageNumber = 1): ExtractedPage => ({
  page: pageNumber,
  imageId: null,
  text,
  lines: [{ text, confidence: 1, boundingBox: { x: 10, y: 20, width: 200, height: 12 } }],
});

const provider = (implementation?: OcrProvider["extract"]): OcrProvider => ({
  name: "test_ocr",
  model: "test-model",
  version: "2026-08-12",
  extract: implementation ?? vi.fn(async (request) => ({
    page: request.page,
    imageId: request.imageId,
    text: "Transfer Successful MYR 3,500.00 Reference TXN12345 Maybank 2026-08-12",
    lines: [{ text: "Transfer Successful MYR 3,500.00 Reference TXN12345 Maybank 2026-08-12", confidence: 0.94 }],
    raw: { fixture: true },
  })),
});

describe("document extraction pipeline", () => {
  beforeAll(() => {
    process.env.DOCUMENT_OCR_REQUEST_ATTEMPTS = "2";
  });

  it("uses a readable PDF text layer before OCR", async () => {
    const ocr = provider();
    const render = vi.fn(async () => { throw new Error("OCR render must not run"); });
    const result = await extractDocument({
      bytes: new Uint8Array([1]), mimeType: "application/pdf", evidenceId: "evidence-1", declaredPageCount: 1, ocrProvider: ocr,
    }, {
      extractNativePdfText: vi.fn(async () => ({ pageCount: 1, pages: [page("Instant Transfer MYR 45.00 Reference ABC12345")], usable: true, rawCharacterCount: 50 })),
      renderPdfPagesToPng: render,
    });
    expect(result.extractionMethod).toBe("pdf_text_layer");
    expect(result.provider).toBe("local_pdf_text");
    expect(render).not.toHaveBeenCalled();
    expect(ocr.extract).not.toHaveBeenCalled();
  });

  it("falls back to bounded page OCR for a scanned PDF", async () => {
    const ocr = provider();
    const render = vi.fn(async () => [
      { page: 1, bytes: new Uint8Array([1]) },
      { page: 2, bytes: new Uint8Array([2]) },
    ]);
    const result = await extractDocument({
      bytes: new Uint8Array([1]), mimeType: "application/pdf", evidenceId: "evidence-2", declaredPageCount: 2, ocrProvider: ocr,
    }, {
      extractNativePdfText: vi.fn(async () => ({ pageCount: 2, pages: [page("", 1), page("", 2)], usable: false, rawCharacterCount: 0 })),
      renderPdfPagesToPng: render,
    });
    expect(result.extractionMethod).toBe("ocr");
    expect(render).toHaveBeenCalledWith(expect.any(Uint8Array), [1, 2]);
    expect(ocr.extract).toHaveBeenCalledTimes(2);
    expect(result.result.amount_candidates[0]).toMatchObject({ minor_units: 350000, currency: "MYR" });
  });

  it("routes image OCR through a derived copy and preserves bounding evidence", async () => {
    const preprocess = vi.fn(async () => new Uint8Array([9, 9]));
    const ocr = provider();
    const result = await extractDocument({
      bytes: new Uint8Array([1, 2]), mimeType: "image/heic", evidenceId: "image-1", declaredPageCount: null, ocrProvider: ocr,
    }, { preprocessImageForOcr: preprocess });
    expect(preprocess).toHaveBeenCalledWith(expect.any(Uint8Array));
    expect(ocr.extract).toHaveBeenCalledWith(expect.objectContaining({ bytes: new Uint8Array([9, 9]), mimeType: "image/png" }), expect.any(AbortSignal));
    expect(result.result.reference_candidates[0].evidence).toMatchObject({ source: "ocr", imageId: "image-1" });
  });

  it("keeps unknown or provider-disabled input as a reviewable result", async () => {
    const result = await extractDocument({
      bytes: new Uint8Array([1]), mimeType: "image/png", evidenceId: "image-2", declaredPageCount: null, ocrProvider: null,
    });
    expect(result.needsReview).toBe(true);
    expect(result.result.document_kind.value).toBe("unknown_or_other");
    expect(result.result.warnings).toEqual(expect.arrayContaining(["OCR_PROVIDER_NOT_CONFIGURED", "MANUAL_REVIEW_REQUIRED"]));
  });

  it("retries a provider failure and returns only a stable safe code", async () => {
    const failing = provider(vi.fn(async () => { throw new DOMException("provider details", "AbortError"); }));
    await expect(extractDocument({
      bytes: new Uint8Array([1]), mimeType: "image/png", evidenceId: "image-3", declaredPageCount: null, ocrProvider: failing,
    }, { preprocessImageForOcr: vi.fn(async () => new Uint8Array([2])), sleep: vi.fn(async () => undefined) }))
      .rejects.toEqual(expect.objectContaining<Partial<ExtractionPipelineError>>({ code: "OCR_PROVIDER_TIMEOUT", retryable: true }));
    expect(failing.extract).toHaveBeenCalledTimes(2);
  });
});

describe("deterministic classification and candidates", () => {
  it("keeps integer minor units, the original string, page, snippet, and coordinates", () => {
    const result = buildStructuredExtraction([page("DuitNow Transfer Successful MYR 3,500.00 Reference TXN12345 Maybank 2026-08-12")]);
    expect(result.document_kind.value).toBe("online_bank_transfer_receipt");
    expect(result.amount_candidates[0]).toMatchObject({
      minor_units: 350000,
      currency: "MYR",
      recognized_string: "MYR 3,500.00",
      evidence: { source: "pdf_text_layer", page: 1 },
    });
    expect(result.amount_candidates[0].evidence.boundingBox).toBeDefined();
    expect(result.parser_version).toMatch(/^collectboss-document-parser\//u);
  });
});

