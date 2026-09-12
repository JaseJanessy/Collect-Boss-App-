import type { ContactPreferenceRow } from "@/lib/supabase/types";

export const EMAIL_TEMPLATE_VARIABLES = [
  "customer_name",
  "invoice_number",
  "due_date",
  "outstanding_amount",
  "payment_link",
  "business_signature",
] as const;

export const DEFAULT_EMAIL_TEMPLATES = [
  {
    name: "Friendly payment reminder",
    subject_template: "Payment reminder: {{invoice_number}}",
    body_template: "Hello {{customer_name}},\n\nThis is a friendly reminder that invoice {{invoice_number}} was due on {{due_date}}. The outstanding amount is {{outstanding_amount}}.\n\nYou can review payment options here: {{payment_link}}\n\nIf payment has already been arranged, please reply to let us know.\n\n{{business_signature}}",
  },
  {
    name: "Formal payment follow-up",
    subject_template: "Payment follow-up: {{invoice_number}}",
    body_template: "Dear {{customer_name}},\n\nOur records show an outstanding balance of {{outstanding_amount}} for invoice {{invoice_number}}, due {{due_date}}.\n\nPlease review the account and payment options at {{payment_link}}, or reply if you need us to review the account with you.\n\n{{business_signature}}",
  },
  {
    name: "Final pre-escalation reminder",
    subject_template: "Action requested: overdue invoice {{invoice_number}}",
    body_template: "Dear {{customer_name}},\n\nWe are following up again regarding invoice {{invoice_number}}. The outstanding amount is {{outstanding_amount}}, originally due on {{due_date}}.\n\nPlease make payment or reply to discuss the account. Payment options: {{payment_link}}\n\n{{business_signature}}",
  },
] as const;

export type EmailTemplateVariables = Record<(typeof EMAIL_TEMPLATE_VARIABLES)[number], string>;

export function renderEmailTemplate(template: string, variables: EmailTemplateVariables) {
  return EMAIL_TEMPLATE_VARIABLES.reduce(
    (value, key) => value.replaceAll(`{{${key}}}`, variables[key]),
    template,
  );
}

export function parseEmailList(value: string) {
  return [...new Set(value.split(/[;,\n]/).map((item) => item.trim().toLowerCase()).filter(Boolean))];
}

export function emailBlockedReason(preferences: ContactPreferenceRow | null) {
  if (!preferences) return null;
  if (preferences.do_not_email) return "Customer preference: do not email.";
  if (preferences.email_unsubscribed) return "This address has unsubscribed from email.";
  if (preferences.email_invalid) return "This email address is marked invalid or bounced.";
  if (preferences.invalid_contact) return "Customer contact details are marked invalid.";
  return null;
}

export function extractReplyActivityId(recipients: string[]) {
  for (const recipient of recipients) {
    const match = /(?:^|<)reply\+([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})@/i.exec(recipient);
    if (match) return match[1].toLowerCase();
  }
  return null;
}

export function providerStatusForEvent(eventType: string) {
  if (eventType === "email.sent") return "sent" as const;
  if (eventType === "email.delivered") return "delivered" as const;
  if (eventType === "email.opened") return "read" as const;
  if (["email.failed", "email.bounced", "email.suppressed", "email.complained"].includes(eventType)) return "failed" as const;
  return null;
}
