import "server-only";

import { z } from "zod";

export type MalwareVerdict = "clean" | "suspected" | "malicious";
export type MalwareScanRequest = { bytes: Uint8Array; mimeType: string; sha256: string };
export interface MalwareScanner {
  readonly name: string;
  readonly version: string;
  scan(request: MalwareScanRequest, signal: AbortSignal): Promise<MalwareVerdict>;
}

const responseSchema = z.object({ verdict: z.enum(["clean", "suspected", "malicious"]) }).strict();

export class MalwareScannerConfigurationError extends Error {
  readonly code = "MALWARE_SCANNER_NOT_CONFIGURED";
}

class HttpJsonMalwareScanner implements MalwareScanner {
  readonly name = "http_json";

  constructor(readonly version: string, private readonly endpoint: string, private readonly apiKey: string) {}

  async scan(request: MalwareScanRequest, signal: AbortSignal): Promise<MalwareVerdict> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      signal,
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        mimeType: request.mimeType,
        sha256: request.sha256,
        fileBase64: Buffer.from(request.bytes).toString("base64"),
      }),
    });
    if (!response.ok) throw new Error(`SCANNER_HTTP_${response.status}`);
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > 16_384) throw new Error("SCANNER_RESPONSE_TOO_LARGE");
    const body = await response.text();
    if (body.length > 16_384) throw new Error("SCANNER_RESPONSE_TOO_LARGE");
    const parsed = responseSchema.safeParse(JSON.parse(body));
    if (!parsed.success) throw new Error("SCANNER_RESPONSE_INVALID");
    return parsed.data.verdict;
  }
}

export function createMalwareScannerFromEnvironment(): MalwareScanner | null {
  const provider = process.env.DOCUMENT_MALWARE_SCANNER_PROVIDER?.trim().toLowerCase() || "disabled";
  if (provider === "disabled" || provider === "none" || provider === "unconfigured") return null;
  if (provider !== "http_json") throw new MalwareScannerConfigurationError("Unsupported malware scanner provider.");
  if (process.env.DOCUMENT_MALWARE_SCANNER_ALLOW_THIRD_PARTY !== "true") {
    throw new MalwareScannerConfigurationError("Malware scanning transmission has not been explicitly enabled.");
  }
  const endpoint = process.env.DOCUMENT_MALWARE_SCANNER_HTTP_ENDPOINT?.trim() ?? "";
  const apiKey = process.env.DOCUMENT_MALWARE_SCANNER_API_KEY?.trim() ?? "";
  const version = process.env.DOCUMENT_MALWARE_SCANNER_VERSION?.trim() ?? "";
  if (!endpoint || !apiKey || !version) throw new MalwareScannerConfigurationError("Malware scanner configuration is incomplete.");
  const url = new URL(endpoint);
  if (url.protocol !== "https:") throw new MalwareScannerConfigurationError("The malware scanner endpoint must use HTTPS.");
  return new HttpJsonMalwareScanner(version, url.toString(), apiKey);
}

export function deploymentScannerConfigurationError(): string | null {
  const environment = process.env.NEXT_PUBLIC_APP_ENV ?? (process.env.NODE_ENV === "production" ? "production" : "development");
  if (environment === "development") return null;
  try {
    return createMalwareScannerFromEnvironment() ? null : "MALWARE_SCANNER_NOT_CONFIGURED";
  } catch {
    return "MALWARE_SCANNER_NOT_CONFIGURED";
  }
}
