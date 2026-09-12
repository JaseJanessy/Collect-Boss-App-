import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

afterEach(() => vi.unstubAllEnvs());

describe("accounting credential encryption", () => {
  it("round-trips with authenticated encryption and rejects tampering", async () => {
    vi.stubEnv("ACCOUNTING_TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    const { decryptAccountingSecret, encryptAccountingSecret } = await import("../../src/lib/accounting/crypto");
    const first = encryptAccountingSecret("refresh-token-value");
    const second = encryptAccountingSecret("refresh-token-value");
    expect(first).not.toBe(second);
    expect(first).not.toContain("refresh-token-value");
    expect(decryptAccountingSecret(first)).toBe("refresh-token-value");
    const segments = first.split(".");
    const tamperedCiphertext = Buffer.from(segments[3], "base64url");
    tamperedCiphertext[0] ^= 1;
    segments[3] = tamperedCiphertext.toString("base64url");
    expect(() => decryptAccountingSecret(segments.join("."))).toThrow();
  });

  it("fails closed when the encryption key is missing or malformed", async () => {
    const { encryptAccountingSecret } = await import("../../src/lib/accounting/crypto");
    vi.stubEnv("ACCOUNTING_TOKEN_ENCRYPTION_KEY", "");
    expect(() => encryptAccountingSecret("secret")).toThrow(/not configured/i);
    vi.stubEnv("ACCOUNTING_TOKEN_ENCRYPTION_KEY", Buffer.from("too-short").toString("base64"));
    expect(() => encryptAccountingSecret("secret")).toThrow(/32-byte key/i);
  });
});
