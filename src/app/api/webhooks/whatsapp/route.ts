/**
 * WhatsApp Business Platform webhook.
 *
 * GET  — Meta's subscription handshake (hub.verify_token = WHATSAPP_VERIFY_TOKEN).
 * POST — delivery status updates and inbound replies, authenticated with the
 *        X-Hub-Signature-256 HMAC of the raw body (WHATSAPP_APP_SECRET).
 *        Replies such as STOP / BERHENTI add the sender to the global opt-out list.
 */
import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { verifyWhatsAppSignature } from "@/lib/whatsapp/cloud-api";
import { isStopMessage } from "@/lib/whatsapp/policy";
import { getServiceClient } from "@/lib/supabase/service-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 1_000_000;
const STATUS_ORDER = ["sent", "delivered", "read"] as const;

function sameSecret(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const expected = process.env.WHATSAPP_VERIFY_TOKEN?.trim();
  const token = params.get("hub.verify_token") ?? "";
  const challenge = params.get("hub.challenge") ?? "";
  if (!expected || params.get("hub.mode") !== "subscribe" || !sameSecret(token, expected) || !/^[\w-]{1,200}$/.test(challenge)) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  return new NextResponse(challenge, { status: 200, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
}

type WebhookPayload = {
  entry?: Array<{ changes?: Array<{ value?: {
    statuses?: Array<{ id?: string; status?: string; errors?: Array<{ code?: number; title?: string }> }>;
    messages?: Array<{ from?: string; type?: string; text?: { body?: string }; button?: { text?: string } }>;
  } }> }>;
};

export async function POST(request: NextRequest) {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return NextResponse.json({ error: "Payload too large." }, { status: 413 });
  const rawBody = await request.text();
  if (!verifyWhatsAppSignature(rawBody, request.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }
  const service = await getServiceClient();
  if (!service) return NextResponse.json({ error: "Webhook service is unavailable." }, { status: 503 });

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody) as WebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const status of change.value?.statuses ?? []) {
        if (!status.id || !status.status) continue;
        if (status.status === "failed") {
          const error = status.errors?.[0];
          await service.from("whatsapp_messages").update({
            status: "failed", error_code: String(error?.code ?? "FAILED"), error_message: (error?.title ?? "Delivery failed.").slice(0, 300),
            updated_at: new Date().toISOString(),
          }).eq("provider_message_id", status.id);
          continue;
        }
        const index = STATUS_ORDER.indexOf(status.status as (typeof STATUS_ORDER)[number]);
        if (index < 0) continue;
        // Never move a status backwards (webhooks can arrive out of order).
        await service.from("whatsapp_messages").update({ status: status.status, updated_at: new Date().toISOString() })
          .eq("provider_message_id", status.id).in("status", ["sending", ...STATUS_ORDER.slice(0, index)]);
      }
      for (const message of change.value?.messages ?? []) {
        const text = message.text?.body ?? message.button?.text ?? "";
        if (!message.from || !/^\d{8,15}$/.test(message.from) || !isStopMessage(text)) continue;
        await service.from("whatsapp_opt_outs").upsert({ phone_e164: `+${message.from}`, source: "reply" }, { onConflict: "phone_e164", ignoreDuplicates: true });
      }
    }
  }
  return NextResponse.json({ received: true }, { headers: { "Cache-Control": "no-store" } });
}
