import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

export class EmailProviderError extends Error {}

export interface ProviderAttachment {
  filename: string;
  content: string;
}

export interface SendEmailInput {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text: string;
  replyTo?: string;
  attachments?: ProviderAttachment[];
  idempotencyKey: string;
}

export interface EmailProvider {
  readonly name: "resend";
  send(input: SendEmailInput): Promise<{ messageId: string }>;
  verifyDomain(domain: string): Promise<{ verified: boolean; reason: string | null }>;
  retrieveInbound(messageId: string): Promise<{ text: string | null; html: string | null; headers: Record<string, string> }>;
}

function apiKey() {
  const value = process.env.RESEND_API_KEY?.trim();
  if (!value) throw new EmailProviderError("Email delivery is not configured: RESEND_API_KEY is missing.");
  return value;
}

async function resendRequest(path: string, init?: RequestInit) {
  const response = await fetch(`https://api.resend.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    const message = typeof payload?.message === "string" ? payload.message : "Email provider request failed.";
    throw new EmailProviderError(message);
  }
  return payload ?? {};
}

export const resendEmailProvider: EmailProvider = {
  name: "resend",
  async send(input) {
    const payload = await resendRequest("/emails", {
      method: "POST",
      headers: { "Idempotency-Key": input.idempotencyKey },
      body: JSON.stringify({
        from: input.from,
        to: input.to,
        ...(input.cc?.length ? { cc: input.cc } : {}),
        ...(input.bcc?.length ? { bcc: input.bcc } : {}),
        subject: input.subject,
        text: input.text,
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
        ...(input.attachments?.length ? { attachments: input.attachments } : {}),
      }),
    });
    if (typeof payload.id !== "string" || !payload.id) throw new EmailProviderError("Email provider returned no message ID.");
    return { messageId: payload.id };
  },
  async verifyDomain(domain) {
    const payload = await resendRequest("/domains");
    const domains = Array.isArray(payload.data) ? payload.data : [];
    const match = domains.find((item) => item && typeof item === "object"
      && String((item as Record<string, unknown>).name).toLowerCase() === domain.toLowerCase()) as Record<string, unknown> | undefined;
    if (!match) return { verified: false, reason: `Domain ${domain} is not configured with the email provider.` };
    const verified = String(match.status).toLowerCase() === "verified";
    return { verified, reason: verified ? null : `Domain ${domain} is not verified by the email provider.` };
  },
  async retrieveInbound(messageId) {
    const payload = await resendRequest(`/emails/receiving/${encodeURIComponent(messageId)}`);
    const headers = payload.headers && typeof payload.headers === "object" && !Array.isArray(payload.headers)
      ? Object.fromEntries(Object.entries(payload.headers as Record<string, unknown>).map(([key, value]) => [key, String(value)]))
      : {};
    return {
      text: typeof payload.text === "string" ? payload.text : null,
      html: typeof payload.html === "string" ? payload.html : null,
      headers,
    };
  },
};

export function emailProviderConfigured() {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

export function getEmailProvider(name = "resend") {
  if (name !== "resend") throw new EmailProviderError(`Unsupported email provider: ${name}.`);
  return resendEmailProvider;
}

export function verifyResendWebhook(input: {
  payload: string;
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}) {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (!secret) throw new EmailProviderError("Email webhook verification is not configured.");
  if (!input.id || !input.timestamp || !input.signature) return false;
  const unix = Number(input.timestamp);
  if (!Number.isFinite(unix) || Math.abs(Date.now() / 1000 - unix) > 300) return false;
  const keyText = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let key: Buffer;
  try { key = Buffer.from(keyText, "base64"); } catch { return false; }
  if (!key.length) return false;
  const expected = createHmac("sha256", key)
    .update(`${input.id}.${input.timestamp}.${input.payload}`)
    .digest();
  return input.signature.split(" ").some((candidate) => {
    const [version, encoded] = candidate.split(",", 2);
    if (version !== "v1" || !encoded) return false;
    try {
      const actual = Buffer.from(encoded, "base64");
      return actual.length === expected.length && timingSafeEqual(actual, expected);
    } catch { return false; }
  });
}
