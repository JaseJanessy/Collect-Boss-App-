import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/stripe/server", () => ({ getStripeServer: () => null }));

describe("Stripe Connect online payments", () => {
  it("maps Stripe payment methods to CollectBoss payment methods", async () => {
    const { onlinePaymentMethod } = await import("@/lib/stripe/connect");
    expect(onlinePaymentMethod("fpx")).toBe("online_fpx");
    expect(onlinePaymentMethod("card")).toBe("online_card");
    expect(onlinePaymentMethod("grabpay")).toBe("online_other");
    expect(onlinePaymentMethod(undefined)).toBe("online_other");
  });

  it("records each checkout once, checks account and amount, and leaves approval to the owner", () => {
    const sql = readFileSync("supabase/migrations/20260922_stripe_connect_online_payments.sql", "utf8");
    expect(sql).toMatch(/for update;/);
    expect(sql).toMatch(/if v_session\.payment_id is not null then return v_session\.payment_id; end if;/);
    expect(sql).toMatch(/checkout account mismatch/);
    expect(sql).toMatch(/checkout amount mismatch/);
    expect(sql).toMatch(/'pending_review'/);
    expect(sql).toMatch(/revoke insert, update, delete on public\.business_payment_connections, public\.online_payment_sessions from anon, authenticated/);
  });

  it("charges on the business's own account and never trusts a client amount", () => {
    const route = readFileSync("src/app/api/public/pay/[token]/checkout/route.ts", "utf8");
    expect(route).toMatch(/stripeAccount: connection\.stripe_account_id/);
    expect(route).toMatch(/amountMinor > collectableMinor/);
    expect(route).toMatch(/enforcePublicRateLimit/);
    const webhook = readFileSync("src/app/api/stripe/connect-webhook/route.ts", "utf8");
    expect(webhook).toMatch(/constructEvent\(rawBody, signature, secret\)/);
    expect(webhook).toMatch(/online_payment_sessions"\)\.select\("id"\)\.eq\("checkout_session_id"/);
  });
});
