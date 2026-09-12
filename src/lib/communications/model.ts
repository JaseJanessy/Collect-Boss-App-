import type {
  CommunicationActivityRow,
  CommunicationChannel,
  CommunicationCounters,
  CommunicationStatus,
} from "@/lib/supabase/types";

export const CALL_OUTCOMES = [
  "no_answer",
  "spoke_to_customer",
  "promise_to_pay",
  "call_back_later",
  "payment_difficulty",
  "other",
] as const;

export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export const CALL_OUTCOME_LABELS: Record<CallOutcome, string> = {
  no_answer: "No Answer",
  spoke_to_customer: "Spoke to Customer",
  promise_to_pay: "Promise to Pay",
  call_back_later: "Call Back Later",
  payment_difficulty: "Payment Difficulty",
  other: "Other",
};

export const COMMUNICATION_CHANNEL_LABELS: Record<CommunicationChannel, string> = {
  whatsapp: "WhatsApp",
  call: "Call",
  email: "Email",
  portal: "Portal",
  other: "Other",
};

export const COMMUNICATION_STATUS_LABELS: Record<CommunicationStatus, string> = {
  initiated: "Initiated",
  sent: "Sent",
  delivered: "Delivered",
  read: "Read",
  replied: "Replied",
  failed: "Failed",
  completed: "Completed",
};

export const emptyCommunicationCounters = (): CommunicationCounters => ({
  calls: 0,
  whatsapps: 0,
  emails: 0,
  last_contact_at: null,
  last_response_at: null,
});

export function calculateCommunicationCounters(
  activities: CommunicationActivityRow[],
): CommunicationCounters {
  const counters = emptyCommunicationCounters();
  for (const activity of activities) {
    if (activity.channel === "call") counters.calls += 1;
    if (activity.channel === "whatsapp") counters.whatsapps += 1;
    if (activity.channel === "email") counters.emails += 1;

    if (activity.direction === "outbound" && activity.status !== "failed") {
      const contactedAt = activity.started_at;
      if (!counters.last_contact_at || contactedAt > counters.last_contact_at) {
        counters.last_contact_at = contactedAt;
      }
    }
    if (activity.direction === "inbound" || activity.status === "replied") {
      const responseAt = activity.completed_at ?? activity.started_at;
      if (!counters.last_response_at || responseAt > counters.last_response_at) {
        counters.last_response_at = responseAt;
      }
    }
  }
  return counters;
}
