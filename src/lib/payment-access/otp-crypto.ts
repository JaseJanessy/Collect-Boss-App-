import { createHash, createHmac, randomBytes, randomInt } from "node:crypto";

export function generateOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function generatePaymentSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashOtpCode(tokenId: string, code: string, pepper: string): string {
  return createHmac("sha256", pepper).update(`${tokenId}:${code}`, "utf8").digest("hex");
}

export function hashSensitiveValue(value: string, pepper: string): string {
  return createHmac("sha256", pepper).update(value, "utf8").digest("hex");
}

export function hashPaymentSession(session: string): string {
  return createHash("sha256").update(session, "utf8").digest("hex");
}

export function maskEmail(value: string): string {
  const [local, domain] = value.trim().split("@");
  if (!local || !domain) return "registered email";
  return `${local.slice(0, 1)}${"*".repeat(Math.max(2, Math.min(6, local.length - 1)))}@${domain}`;
}

export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 4 ? `••••••${digits.slice(-4)}` : "registered mobile";
}
