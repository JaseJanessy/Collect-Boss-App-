import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const VERSION = "v1";

function encryptionKey() {
  const configured = process.env.ACCOUNTING_TOKEN_ENCRYPTION_KEY?.trim();
  if (!configured) {
    throw new Error("Accounting integrations are unavailable: ACCOUNTING_TOKEN_ENCRYPTION_KEY is not configured.");
  }
  const decoded = Buffer.from(configured, "base64");
  if (decoded.length !== 32) {
    throw new Error("Accounting integrations are unavailable: ACCOUNTING_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }
  return decoded;
}

export function encryptAccountingSecret(plaintext: string) {
  if (!plaintext) throw new Error("Refusing to encrypt an empty accounting secret.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptAccountingSecret(envelope: string) {
  const [version, ivText, tagText, ciphertextText, extra] = envelope.split(".");
  if (version !== VERSION || !ivText || !tagText || !ciphertextText || extra) {
    throw new Error("Stored accounting credentials use an unsupported encryption envelope.");
  }
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function digestAccountingValue(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
