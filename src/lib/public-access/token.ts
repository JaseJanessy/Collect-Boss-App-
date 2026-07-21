import { createHash, randomBytes } from "node:crypto";

export const PUBLIC_TOKEN_BYTES = 32;

export function hashPublicToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Generates a 256-bit, URL-safe capability. Only its SHA-256 hash is persisted. */
export function generatePublicToken(): string {
  return randomBytes(PUBLIC_TOKEN_BYTES).toString("base64url");
}

/** Never include a raw capability in logs, errors, analytics, or audit metadata. */
export function redactPublicToken(token: string): string {
  void token;
  return "[REDACTED_PUBLIC_TOKEN]";
}
