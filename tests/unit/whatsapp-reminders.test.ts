import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isStopMessage, isWithinSendWindow, offsetLabel, reminderSkipReason } from "@/lib/whatsapp/policy";

vi.mock("server-only", () => ({}));

describe("WhatsApp reminder rules", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("only sends between 9am and 8pm Malaysia time", () => {
    expect(isWithinSendWindow(new Date("2026-10-01T00:59:00Z"))).toBe(false); // 08:59 MYT
    expect(isWithinSendWindow(new Date("2026-10-01T01:00:00Z"))).toBe(true); // 09:00 MYT
    expect(isWithinSendWindow(new Date("2026-10-01T11:59:00Z"))).toBe(true); // 19:59 MYT
    expect(isWithinSendWindow(new Date("2026-10-01T12:00:00Z"))).toBe(false); // 20:00 MYT
  });

  it("recognises STOP replies in English and Malay", () => {
    for (const text of ["STOP", " stop ", "Berhenti", "henti!", "Unsubscribe"]) expect(isStopMessage(text), text).toBe(true);
    for (const text of ["I will pay tomorrow", "stop calling me later maybe", "ok"]) expect(isStopMessage(text), text).toBe(false);
  });

  it("skips customers who opted out, bad contacts and paid invoices", () => {
    const ok = { optedOut: false, preferences: null, outstandingMinor: 1000, obligationStatus: "overdue" };
    expect(reminderSkipReason(ok)).toBeNull();
    expect(reminderSkipReason({ ...ok, optedOut: true })).toBe("customer_opted_out");
    expect(reminderSkipReason({ ...ok, preferences: { wrong_number: true } })).toBe("wrong_number");
    expect(reminderSkipReason({ ...ok, preferences: { email_only: true } })).toBe("email_only");
    expect(reminderSkipReason({ ...ok, outstandingMinor: 0 })).toBe("nothing_outstanding");
    expect(reminderSkipReason({ ...ok, obligationStatus: "void" })).toBe("not_collectable");
    expect(offsetLabel(-3)).toBe("3 days before");
    expect(offsetLabel(0)).toBe("On the due date");
    expect(offsetLabel(1)).toBe("1 day after");
  });

  it("verifies Meta webhook signatures against the raw body", async () => {
    vi.stubEnv("WHATSAPP_APP_SECRET", "test-app-secret");
    const { verifyWhatsAppSignature } = await import("@/lib/whatsapp/cloud-api");
    const body = JSON.stringify({ entry: [] });
    const signature = `sha256=${createHmac("sha256", "test-app-secret").update(body).digest("hex")}`;
    expect(verifyWhatsAppSignature(body, signature)).toBe(true);
    expect(verifyWhatsAppSignature(body + " ", signature)).toBe(false);
    expect(verifyWhatsAppSignature(body, null)).toBe(false);
  });

  it("queues idempotently, paid plans only, and keeps writes server-side", () => {
    const migration = readFileSync("supabase/migrations/20260921_whatsapp_auto_reminders.sql", "utf8");
    expect(migration).toMatch(/unique \(business_id, customer_id, local_send_date\)/);
    expect(migration).toMatch(/e\.plan_slug <> 'free'/);
    expect(migration).toMatch(/not enabled or consent_attested_at is not null/);
    expect(migration).toMatch(/revoke insert, update, delete on public\.whatsapp_reminder_policies, public\.whatsapp_messages from anon, authenticated/);
  });
});
