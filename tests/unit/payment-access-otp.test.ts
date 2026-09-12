import { describe, expect, it } from "vitest";
import {
  generateOtpCode,
  generatePaymentSessionToken,
  hashOtpCode,
  hashPaymentSession,
  maskEmail,
  maskPhone,
} from "@/lib/payment-access/otp-crypto";

describe("secure payment OTP primitives", () => {
  it("generates six-digit codes and high-entropy session tokens", () => {
    const codes = new Set(Array.from({ length: 50 }, generateOtpCode));
    expect([...codes].every((code) => /^\d{6}$/.test(code))).toBe(true);
    expect(codes.size).toBeGreaterThan(1);
    const first = generatePaymentSessionToken();
    const second = generatePaymentSessionToken();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first).not.toBe(second);
  });

  it("hashes codes with token scope and a server pepper", () => {
    const pepper = "a-production-length-secret-pepper-value";
    const first = hashOtpCode("token-a", "123456", pepper);
    expect(first).toHaveLength(64);
    expect(first).toBe(hashOtpCode("token-a", "123456", pepper));
    expect(first).not.toBe(hashOtpCode("token-b", "123456", pepper));
    expect(first).not.toContain("123456");
  });

  it("stores only a deterministic session hash", () => {
    const raw = generatePaymentSessionToken();
    expect(hashPaymentSession(raw)).toHaveLength(64);
    expect(hashPaymentSession(raw)).not.toBe(raw);
  });

  it("masks registered destinations", () => {
    expect(maskEmail("person@example.com")).toBe("p*****@example.com");
    expect(maskPhone("+60 12-345 6789")).toBe("••••••6789");
  });
});
