import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * WhatsApp Business Platform (Meta Cloud API) client for one verified
 * CollectBoss sender number. Business-initiated messages must use templates
 * that Meta has approved; see docs/WHATSAPP_REMINDERS.md for their text.
 */

export type WhatsAppTemplateKind = "before_due" | "due_today" | "overdue";
export type WhatsAppLanguage = "en" | "ms";

export class WhatsAppProviderError extends Error {
  constructor(message: string, readonly code: string, readonly retryable: boolean) {
    super(message);
  }
}

const DEFAULT_TEMPLATES: Record<WhatsAppTemplateKind, string> = {
  before_due: "payment_reminder_before_due",
  due_today: "payment_reminder_due_today",
  overdue: "payment_reminder_overdue",
};

const TEMPLATE_ENV: Record<WhatsAppTemplateKind, string> = {
  before_due: "WHATSAPP_TEMPLATE_BEFORE_DUE",
  due_today: "WHATSAPP_TEMPLATE_DUE_TODAY",
  overdue: "WHATSAPP_TEMPLATE_OVERDUE",
};

export function whatsappConfig() {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() ?? "";
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim() ?? "";
  const graphVersion = process.env.WHATSAPP_GRAPH_VERSION?.trim() || "v21.0";
  return {
    configured: /^\d{5,30}$/.test(phoneNumberId) && accessToken.length > 20,
    phoneNumberId,
    accessToken,
    graphVersion,
  };
}

export function whatsappTemplateName(kind: WhatsAppTemplateKind): string {
  const configured = process.env[TEMPLATE_ENV[kind]]?.trim();
  return configured && /^[a-z0-9_]{1,512}$/.test(configured) ? configured : DEFAULT_TEMPLATES[kind];
}

/** Sends an approved template message. Returns Meta's message ID. */
export async function sendWhatsAppTemplate(input: {
  to: string;
  kind: WhatsAppTemplateKind;
  language: WhatsAppLanguage;
  bodyParameters: string[];
}): Promise<{ messageId: string }> {
  const config = whatsappConfig();
  if (!config.configured) throw new WhatsAppProviderError("WhatsApp sending is not configured.", "NOT_CONFIGURED", false);
  if (!/^\+[1-9]\d{7,14}$/.test(input.to)) throw new WhatsAppProviderError("Invalid recipient number.", "INVALID_RECIPIENT", false);

  let response: Response;
  try {
    response = await fetch(`https://graph.facebook.com/${config.graphVersion}/${config.phoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: input.to.slice(1),
        type: "template",
        template: {
          name: whatsappTemplateName(input.kind),
          language: { code: input.language === "ms" ? "ms" : "en" },
          components: [{
            type: "body",
            parameters: input.bodyParameters.map((text) => ({ type: "text", text: text.slice(0, 200) })),
          }],
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new WhatsAppProviderError("WhatsApp could not be reached.", "NETWORK", true);
  }
  const payload = await response.json().catch(() => null) as {
    messages?: Array<{ id?: string }>;
    error?: { code?: number; message?: string };
  } | null;
  const messageId = payload?.messages?.[0]?.id;
  if (response.ok && messageId) return { messageId };
  const code = String(payload?.error?.code ?? response.status);
  // 131026 undeliverable, 131047 re-engagement, 132000/132001 template issues: do not retry.
  const retryable = response.status >= 500 || response.status === 429 || code === "130429" || code === "131000";
  throw new WhatsAppProviderError(payload?.error?.message?.slice(0, 300) ?? "WhatsApp rejected the message.", code, retryable);
}

/** Verifies Meta's X-Hub-Signature-256 header against the raw request body. */
export function verifyWhatsAppSignature(rawBody: string, header: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET?.trim();
  if (!secret || !header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`);
  const received = Buffer.from(header);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
