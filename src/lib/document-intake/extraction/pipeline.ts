import "server-only";

import { extractionConfig, EXTRACTION_PARSER_VERSION, PDF_TEXT_PARSER_VERSION } from "./config";
import { buildStructuredExtraction } from "./classifier";
import { preprocessImageForOcr } from "./image";
import { extractNativePdfText, renderPdfPagesToPng } from "./pdf";
import type {
  DocumentExtractionOutput,
  ExtractedPage,
  NativePdfExtraction,
  OcrPageResult,
  OcrProvider,
} from "./types";

export class ExtractionPipelineError extends Error {
  constructor(readonly code: string, readonly retryable: boolean) {
    super(code);
  }
}

type PipelineDependencies = {
  extractNativePdfText: typeof extractNativePdfText;
  renderPdfPagesToPng: typeof renderPdfPagesToPng;
  preprocessImageForOcr: typeof preprocessImageForOcr;
  sleep: (milliseconds: number) => Promise<void>;
};

const defaults: PipelineDependencies = {
  extractNativePdfText,
  renderPdfPagesToPng,
  preprocessImageForOcr,
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

function safeProviderError(reason: unknown): ExtractionPipelineError {
  if (reason instanceof ExtractionPipelineError) return reason;
  if (reason instanceof Error && (reason.name === "AbortError" || reason.message === "OCR_TIMEOUT")) {
    return new ExtractionPipelineError("OCR_PROVIDER_TIMEOUT", true);
  }
  if (reason instanceof Error && reason.message === "OCR_RESPONSE_INVALID") {
    return new ExtractionPipelineError("OCR_PROVIDER_RESPONSE_INVALID", false);
  }
  return new ExtractionPipelineError("OCR_PROVIDER_UNAVAILABLE", true);
}

async function ocrWithRetry(provider: OcrProvider, request: Parameters<OcrProvider["extract"]>[0], deps: PipelineDependencies) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= extractionConfig.providerAttempts; attempt += 1) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort(new Error("OCR_TIMEOUT"));
        reject(new ExtractionPipelineError("OCR_PROVIDER_TIMEOUT", true));
      }, extractionConfig.providerTimeoutMs);
    });
    try {
      return await Promise.race([provider.extract(request, controller.signal), timeout]);
    } catch (error) {
      lastError = error;
      if (attempt < extractionConfig.providerAttempts) await deps.sleep(250 * 2 ** (attempt - 1));
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  throw safeProviderError(lastError);
}

function outputFromPages(input: {
  pages: ExtractedPage[];
  method: "pdf_text_layer" | "ocr";
  provider: OcrProvider | null;
  protectedRaw: Record<string, unknown>;
  additionalWarnings?: string[];
}): DocumentExtractionOutput {
  const result = buildStructuredExtraction(input.pages);
  result.warnings.push(...(input.additionalWarnings ?? []));
  result.warnings = [...new Set(result.warnings)];
  const lineConfidences = input.pages.flatMap((page) => page.lines.map((line) => line.confidence).filter((value): value is number => value !== null));
  const textConfidence = lineConfidences.length ? lineConfidences.reduce((sum, value) => sum + value, 0) / lineConfidences.length : 0;
  const confidence = Math.round(Math.min(result.document_kind.confidence, textConfidence || result.document_kind.confidence) * 10_000) / 10_000;
  const needsReview = confidence < extractionConfig.minimumClassificationConfidence || result.warnings.length > 0;
  return {
    provider: input.method === "pdf_text_layer" ? "local_pdf_text" : input.provider?.name ?? "disabled",
    providerModel: input.method === "pdf_text_layer" ? "pdf-text-layer" : input.provider?.model ?? "none",
    providerVersion: input.method === "pdf_text_layer" ? PDF_TEXT_PARSER_VERSION : input.provider?.version ?? "none",
    parserVersion: EXTRACTION_PARSER_VERSION,
    extractionMethod: input.method,
    result,
    protectedRawResult: input.protectedRaw,
    confidence,
    needsReview,
  };
}

async function pagesFromOcr(provider: OcrProvider, images: Array<{ bytes: Uint8Array; page: number | null; imageId: string }>, deps: PipelineDependencies) {
  const results: OcrPageResult[] = [];
  for (const image of images) {
    results.push(await ocrWithRetry(provider, { ...image, mimeType: "image/png" }, deps));
  }
  return results;
}

export async function extractDocument(input: {
  bytes: Uint8Array;
  mimeType: string;
  evidenceId: string;
  declaredPageCount: number | null;
  ocrProvider: OcrProvider | null;
}, dependencies: Partial<PipelineDependencies> = {}): Promise<DocumentExtractionOutput> {
  const deps = { ...defaults, ...dependencies };
  const isPdf = input.mimeType === "application/pdf";
  const isImage = input.mimeType === "image/png" || input.mimeType === "image/jpeg" || input.mimeType === "image/heic";
  if (!isPdf && !isImage) throw new ExtractionPipelineError("UNSUPPORTED_FILE_TYPE", false);
  if (input.declaredPageCount && input.declaredPageCount > extractionConfig.maxPages) {
    return outputFromPages({
      pages: [], method: isPdf ? "pdf_text_layer" : "ocr", provider: input.ocrProvider,
      protectedRaw: { reason: "configured_page_limit", declaredPageCount: input.declaredPageCount },
      additionalWarnings: ["PAGE_LIMIT_EXCEEDED", "MANUAL_REVIEW_REQUIRED"],
    });
  }

  if (isPdf) {
    let native: NativePdfExtraction;
    try {
      native = await deps.extractNativePdfText(input.bytes);
    } catch {
      throw new ExtractionPipelineError("PDF_TEXT_EXTRACTION_FAILED", false);
    }
    if (native.pageCount > extractionConfig.maxPages) {
      return outputFromPages({
        pages: native.pages, method: "pdf_text_layer", provider: null,
        protectedRaw: { pages: native.pages, pageCount: native.pageCount, rawCharacterCount: native.rawCharacterCount },
        additionalWarnings: ["PAGE_LIMIT_EXCEEDED", "MANUAL_REVIEW_REQUIRED"],
      });
    }
    if (native.usable) {
      return outputFromPages({
        pages: native.pages, method: "pdf_text_layer", provider: null,
        protectedRaw: { pages: native.pages, pageCount: native.pageCount, rawCharacterCount: native.rawCharacterCount },
      });
    }
    if (!input.ocrProvider) {
      return outputFromPages({
        pages: native.pages, method: "ocr", provider: null,
        protectedRaw: { pages: native.pages, pageCount: native.pageCount, rawCharacterCount: native.rawCharacterCount },
        additionalWarnings: ["NO_READABLE_TEXT", "OCR_PROVIDER_NOT_CONFIGURED", "MANUAL_REVIEW_REQUIRED"],
      });
    }
    const pageNumbers = Array.from({ length: Math.min(native.pageCount, extractionConfig.maxOcrPages) }, (_, index) => index + 1);
    const rendered = await deps.renderPdfPagesToPng(input.bytes, pageNumbers);
    const ocr = await pagesFromOcr(input.ocrProvider, rendered.map((page) => ({
      ...page,
      imageId: `${input.evidenceId}:page:${page.page}`,
    })), deps);
    return outputFromPages({
      pages: ocr.map((page) => ({ page: page.page, imageId: page.imageId, text: page.text, lines: page.lines })),
      method: "ocr", provider: input.ocrProvider,
      protectedRaw: { pages: ocr.map((page) => ({ ...page, raw: page.raw })) },
      additionalWarnings: native.pageCount > extractionConfig.maxOcrPages ? ["OCR_PAGE_LIMIT_REACHED", "MANUAL_REVIEW_REQUIRED"] : [],
    });
  }

  if (!input.ocrProvider) {
    return outputFromPages({
      pages: [], method: "ocr", provider: null,
      protectedRaw: { reason: "provider_not_configured" },
      additionalWarnings: ["OCR_PROVIDER_NOT_CONFIGURED", "MANUAL_REVIEW_REQUIRED"],
    });
  }
  let derived: Uint8Array;
  try {
    derived = await deps.preprocessImageForOcr(input.bytes);
  } catch {
    throw new ExtractionPipelineError("IMAGE_PREPROCESSING_FAILED", false);
  }
  const ocr = await pagesFromOcr(input.ocrProvider, [{ bytes: derived, page: null, imageId: input.evidenceId }], deps);
  return outputFromPages({
    pages: ocr.map((page) => ({ page: null, imageId: page.imageId, text: page.text, lines: page.lines })),
    method: "ocr", provider: input.ocrProvider,
    protectedRaw: { pages: ocr.map((page) => ({ ...page, raw: page.raw })) },
  });
}
