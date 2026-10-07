import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_EMAIL_TEMPLATES,
  emailBlockedReason,
  extractReplyActivityId,
  providerStatusForEvent,
  renderEmailTemplate,
} from "@/lib/email/model";
import type { ContactPreferenceRow } from "@/lib/supabase/types";

const preference = (overrides: Partial<ContactPreferenceRow> = {}): ContactPreferenceRow => ({
  id: "11111111-1111-4111-8111-111111111111",
  business_id: "22222222-2222-4222-8222-222222222222",
  customer_id: "33333333-3333-4333-8333-333333333333",
  preferred_channel: null,
  preferred_time_start: null,
  preferred_time_end: null,
  email_only: false,
  do_not_call: false,
  wrong_number: false,
  invalid_contact: false,
  do_not_email: false,
  email_invalid: false,
  email_unsubscribed: false,
  last_email_bounced_at: null,
  note: null,
  documented_at: "2026-08-01T00:00:00.000Z",
  documented_by: null,
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-01T00:00:00.000Z",
  ...overrides,
});

describe("Email Communications 2.0", () => {
  it("renders approved templates using the documented variables", () => {
    const rendered = renderEmailTemplate(DEFAULT_EMAIL_TEMPLATES[0].body_template, {
      customer_name: "Acme Ltd",
      invoice_number: "INV-42",
      due_date: "1 August 2026",
      outstanding_amount: "RM 1,250.00",
      payment_link: "https://example.test/pay/token",
      business_signature: "CollectBoss Finance",
    });
    expect(rendered).toContain("Acme Ltd");
    expect(rendered).toContain("INV-42");
    expect(rendered).toContain("https://example.test/pay/token");
    expect(rendered).not.toContain("{{");
  });

  it.each([
    ["do_not_email", { do_not_email: true }],
    ["unsubscribed", { email_unsubscribed: true }],
    ["bounced", { email_invalid: true }],
  ])("hard-blocks %s email preferences", (_label, overrides) => {
    expect(emailBlockedReason(preference(overrides))).toBeTruthy();
  });

  it("extracts only a routed activity UUID from an inbound reply address", () => {
    expect(extractReplyActivityId(["reply+11111111-1111-4111-8111-111111111111@replies.example.com"]))
      .toBe("11111111-1111-4111-8111-111111111111");
    expect(extractReplyActivityId(["collections@example.com"])).toBeNull();
  });

  it("maps only provider-backed lifecycle events to visible statuses", () => {
    expect(providerStatusForEvent("email.sent")).toBe("sent");
    expect(providerStatusForEvent("email.delivered")).toBe("delivered");
    expect(providerStatusForEvent("email.opened")).toBe("read");
    expect(providerStatusForEvent("email.bounced")).toBe("failed");
    expect(providerStatusForEvent("email.clicked")).toBeNull();
  });

  it("keeps provider IDs, scheduling idempotency, RLS, and internal attachment controls in the migration", () => {
    const sql = readFileSync("supabase/migrations/20260828_i03_email_communications_2.sql", "utf8");
    expect(sql).toContain("provider_message_id");
    expect(sql).toContain("unique (business_id,idempotency_key)");
    expect(sql).toContain("email_webhook_events");
    expect(sql).toContain("enable row level security");
    expect(readFileSync("src/lib/email/service.ts", "utf8")).toContain('.eq("is_internal", false)');
    const proxy = readFileSync("src/proxy.ts", "utf8");
    expect(proxy).toContain('"/api/webhooks/resend"');
    expect(proxy).toContain("isSignedWebhook");
  });
});
