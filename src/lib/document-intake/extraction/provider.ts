import "server-only";

import { z } from "zod";
import type { OcrPageResult, OcrProvider, OcrRequest } from "./types";

const providerResponseSchema = z.object({
  text: z.string().max(500_000),
  language: z.string().max(32).nullable().optional(),
  lines: z.array(z.object({
    text: z.string().max(10_000),
    confidence: z.number().min(0).max(1).nullable().optional(),
    boundingBox: z.object({
      x: z.number().finite(),
      y: z.number().finite(),
      width: z.number().nonnegative().finite(),
      height: z.number().nonnegative().finite(),
    }).optional(),
  })).max(20_000).default([]),
  raw: z.unknown().optional(),
}).strict();

export class OcrConfigurationError extends Error {
  readonly code = "OCR_PROVIDER_NOT_CONFIGURED";
}

class HttpJsonOcrProvider implements OcrProvider {
  readonly name = "http_json";

  constructor(
    readonly model: string,
    readonly version: string,
    private readonly endpoint: string,
    private readonly apiKey: string,
  ) {}

  async extract(request: OcrRequest, signal: AbortSignal): Promise<OcrPageResult> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        mimeType: request.mimeType,
        page: request.page,
        imageId: request.imageId,
        imageBase64: Buffer.from(request.bytes).toString("base64"),
      }),
    });
    if (!response.ok) throw new Error(`OCR_HTTP_${response.status}`);
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > 2_000_000) throw new Error("OCR_RESPONSE_TOO_LARGE");
    const rawBody = await response.text();
    if (rawBody.length > 2_000_000) throw new Error("OCR_RESPONSE_TOO_LARGE");
    const parsed = providerResponseSchema.safeParse(JSON.parse(rawBody));
    if (!parsed.success) throw new Error("OCR_RESPONSE_INVALID");
    return {
      page: request.page,
      imageId: request.imageId,
      text: parsed.data.text,
      language: parsed.data.language,
      lines: parsed.data.lines.map((line) => ({
        text: line.text,
        confidence: line.confidence ?? null,
        boundingBox: line.boundingBox,
      })),
      // Stored only in the protected raw-result field.
      raw: parsed.data.raw ?? parsed.data,
    };
  }
}

export function createOcrProviderFromEnvironment(): OcrProvider | null {
  const provider = process.env.DOCUMENT_OCR_PROVIDER?.trim().toLowerCase() || "disabled";
  if (provider === "disabled" || provider === "none") return null;
  if (provider !== "http_json") throw new OcrConfigurationError("Unsupported DOCUMENT_OCR_PROVIDER value.");
  if (process.env.DOCUMENT_OCR_ALLOW_THIRD_PARTY !== "true") {
    throw new OcrConfigurationError("Third-party OCR transmission has not been explicitly enabled.");
  }
  const endpoint = process.env.DOCUMENT_OCR_HTTP_ENDPOINT?.trim() ?? "";
  const apiKey = process.env.DOCUMENT_OCR_API_KEY?.trim() ?? "";
  const model = process.env.DOCUMENT_OCR_MODEL?.trim() ?? "";
  const version = process.env.DOCUMENT_OCR_PROVIDER_VERSION?.trim() ?? "";
  if (!endpoint || !apiKey || !model || !version) throw new OcrConfigurationError("OCR provider configuration is incomplete.");
  const url = new URL(endpoint);
  if (url.protocol !== "https:") throw new OcrConfigurationError("The OCR endpoint must use HTTPS.");
  return new HttpJsonOcrProvider(model, version, url.toString(), apiKey);
}

