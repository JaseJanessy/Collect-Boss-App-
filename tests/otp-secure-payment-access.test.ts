import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/20260820_otp_secure_payment_access.sql");
const resolver = read("src/lib/public-access/service.ts");
const page = read("src/components/pages/payments/debtor-payment-page.tsx");
const proofRoute = read("src/app/api/public/pay/[token]/proof/route.ts");
const verifyRoute = read("src/app/api/public/pay/[token]/otp/verify/route.ts");
const delivery = read("src/lib/payment-access/delivery.ts");

test("OTP challenges are hashed, short-lived, attempt-limited, and rate-limited", () => {
  assert.match(migration, /create table if not exists public\.payment_access_otp_challenges/);
  assert.match(migration, /code_hash char\(64\) not null/);
  assert.match(migration, /now\(\)\+interval '7 minutes'/);
  assert.match(migration, /max_attempts smallint not null default 5/);
  assert.match(migration, /now\(\)\+interval '60 seconds'/);
  assert.match(migration, /created_at>now\(\)-interval '10 minutes'\)>=5/);
  assert.match(migration, /created_at>now\(\)-interval '1 hour'\)>=20/);
  assert.match(migration, /set consumed_at=now\(\)/);
});

test("short-lived sessions are server-only and required before details or proof", () => {
  assert.match(migration, /create table if not exists public\.payment_access_sessions/);
  assert.match(migration, /session_hash char\(64\) not null unique/);
  assert.match(migration, /now\(\)\+interval '15 minutes'/);
  assert.match(migration, /verified payment session is required/);
  assert.match(migration, /grant execute on function public\.payment_access_validate_session[\s\S]*to service_role/);
  assert.doesNotMatch(migration, /create policy "[^"]+"[\s\S]{0,100}on public\.payment_access_sessions/);
  assert.match(resolver, /payment_access_validate_session/);
  assert.match(resolver, /if \(!rawSession\) return lockedDetails\(false\)/);
  assert.match(resolver, /verification_status === "verified"/);
  assert.match(proofRoute, /validatePaymentAccessSession/);
  assert.match(proofRoute, /payment_access_session_id: paymentSession\.id/);
  assert.match(migration, /new\.business_id:=v_case\.business_id/);
  assert.match(migration, /new\.receiving_account_id:=v_token\.receiving_account_id/);
  assert.match(migration, /payment reference has already been submitted/);
  assert.match(migration, /new\.status:='submitted'/);
});

test("verified session cookie and debtor UI preserve the direct-to-creditor proof flow", () => {
  assert.match(verifyRoute, /httpOnly: true/);
  assert.match(verifyRoute, /sameSite: "lax"/);
  assert.match(verifyRoute, /maxAge: result\.expires_in \?\? 900/);
  assert.match(page, /Unlock Payment Details/);
  assert.match(page, /Verify the recipient name in your banking app/);
  assert.match(page, /Money moves directly to the creditor/);
  assert.match(page, /payment\.otp\.sessionExpiresAt/);
  assert.match(page, /window\.setTimeout\(\(\) => window\.location\.reload\(\)/);
  assert.match(page, /I&apos;ve Paid/);
  assert.match(page, /Report Suspicious Request/);
});

test("delivery uses configured adapters without embedding credentials", () => {
  for (const variable of [
    "RESEND_API_KEY", "PAYMENT_OTP_FROM_EMAIL", "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER",
  ]) {
    assert.match(delivery, new RegExp(`process\\.env\\.${variable}`));
  }
  assert.match(delivery, /https:\/\/api\.resend\.com\/emails/);
  assert.match(delivery, /api\.twilio\.com/);
  assert.doesNotMatch(delivery, /(re_[A-Za-z0-9]{20,}|AC[a-f0-9]{32})/);
});

test("R13 tables preserve tenant ownership and expose no OTP secrets to browsers", () => {
  for (const table of [
    "payment_access_otp_challenges",
    "payment_access_sessions",
    "payment_access_suspicious_reports",
  ]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(migration, /payment_access_suspicious_reports_owner_read/);
  assert.match(migration, /b\.owner_id=auth\.uid\(\)/);
  assert.doesNotMatch(migration, /to anon/);
});
