import "server-only";

export type OtpDeliveryChannel = "email" | "sms";

export class OtpDeliveryError extends Error {}

export async function deliverPaymentOtp(input: {
  channel: OtpDeliveryChannel;
  destination: string;
  code: string;
  creditorName: string;
  idempotencyKey: string;
}): Promise<string> {
  const message = `${input.code} is your CollectBoss code to unlock ${input.creditorName}'s verified payment details. It expires in 7 minutes. Do not share this code.`;
  if (input.channel === "email") {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    const from = process.env.PAYMENT_OTP_FROM_EMAIL?.trim();
    if (!apiKey || !from) throw new OtpDeliveryError("Email OTP delivery is not configured.");
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey,
      },
      body: JSON.stringify({
        from,
        to: [input.destination],
        subject: "Your CollectBoss payment access code",
        text: message,
      }),
    });
    const payload = await response.json().catch(() => null) as { id?: string } | null;
    if (!response.ok || !payload?.id) throw new OtpDeliveryError("Email OTP delivery failed.");
    return payload.id;
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const from = process.env.TWILIO_FROM_NUMBER?.trim();
  if (!accountSid || !authToken || !from) throw new OtpDeliveryError("SMS OTP delivery is not configured.");
  const form = new URLSearchParams({ To: input.destination, From: from, Body: message });
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  const payload = await response.json().catch(() => null) as { sid?: string } | null;
  if (!response.ok || !payload?.sid) throw new OtpDeliveryError("SMS OTP delivery failed.");
  return payload.sid;
}
