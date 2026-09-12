import "server-only";

export class ReminderDeliveryError extends Error {}

export function reminderEmailDeliveryConfigured() {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.REMINDER_EMAIL_FROM?.trim());
}

export async function deliverReminderEmail(input: {
  to: string;
  subject: string;
  text: string;
}) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.REMINDER_EMAIL_FROM?.trim();
  if (!apiKey || !from) {
    throw new ReminderDeliveryError("Bulk reminder email delivery is not configured.");
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [input.to], subject: input.subject, text: input.text }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => null) as { id?: string; message?: string } | null;
  if (!response.ok || !payload?.id) {
    throw new ReminderDeliveryError(payload?.message ?? "Reminder email delivery failed.");
  }
  return { provider: "resend" as const, providerId: payload.id };
}

