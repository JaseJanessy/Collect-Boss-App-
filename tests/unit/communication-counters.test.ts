import { describe, expect, it } from "vitest";
import { calculateCommunicationCounters } from "@/lib/communications/model";
import { normalizeWhatsAppProviderStatus } from "@/lib/communications/adapters";
import type { CommunicationActivityRow } from "@/lib/supabase/types";

function activity(
  id: string,
  overrides: Partial<CommunicationActivityRow>,
): CommunicationActivityRow {
  return {
    id,
    business_id: "business-1",
    customer_id: "customer-1",
    case_id: "case-1",
    channel: "call",
    direction: "outbound",
    status: "initiated",
    outcome: null,
    started_at: "2026-07-29T01:00:00.000Z",
    completed_at: null,
    staff_user_id: "user-1",
    external_reference: null,
    provider: null,
    provider_message_id: null,
    thread_reference: null,
    sender: null,
    recipients: {},
    subject: null,
    body_text: null,
    sent_at: null,
    delivered_at: null,
    opened_at: null,
    replied_at: null,
    failure_reason: null,
    review_required: false,
    duration_seconds: null,
    metadata: {},
    related_promise_id: null,
    related_dispute_id: null,
    related_action_id: null,
    idempotency_key: id,
    created_at: "2026-07-29T01:00:00.000Z",
    updated_at: "2026-07-29T01:00:00.000Z",
    policy_check_id: null,
    policy_version_id: null,
    policy_result: "not_applicable",
    policy_content_hash: null,
    ...overrides,
  };
}

describe("communication counters", () => {
  it("counts each channel and chooses the latest contact and response", () => {
    const counters = calculateCommunicationCounters([
      activity("1", { channel: "call", completed_at: "2026-07-29T01:10:00.000Z", status: "completed", outcome: "no_answer" }),
      activity("2", { channel: "whatsapp", started_at: "2026-07-29T02:00:00.000Z", status: "sent" }),
      activity("3", { channel: "email", direction: "inbound", started_at: "2026-07-29T03:00:00.000Z", status: "replied" }),
      activity("4", { channel: "whatsapp", started_at: "2026-07-29T04:00:00.000Z", status: "failed" }),
    ]);

    expect(counters).toEqual({
      calls: 1,
      whatsapps: 2,
      emails: 1,
      last_contact_at: "2026-07-29T02:00:00.000Z",
      last_response_at: "2026-07-29T03:00:00.000Z",
    });
  });

  it("normalizes only supported WhatsApp provider states", () => {
    expect(normalizeWhatsAppProviderStatus(" Delivered ")).toBe("delivered");
    expect(normalizeWhatsAppProviderStatus("unknown")).toBeNull();
    expect(normalizeWhatsAppProviderStatus("completed")).toBeNull();
  });
});
