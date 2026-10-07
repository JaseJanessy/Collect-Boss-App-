/**
 * POST /api/public/contact
 *
 * Receives enquiries (including demo requests) from the marketing website
 * and emails them to the CollectBoss team. Cross-origin calls are accepted
 * only from MARKETING_SITE_ORIGINS. Abuse controls: shared rate limit,
 * honeypot field, strict schema and size limits. Nothing is stored.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { enforcePublicRateLimit, publicRateLimitResponse } from "@/lib/api/public-rate-limit";
import { isMarketingSiteOrigin } from "@/lib/api/marketing-origins";
import { getEmailProvider } from "@/lib/email/provider";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ENQUIRY_TYPES = [
  "Request a Demo",
  "Sales Enquiry",
  "Support",
  "Security Question",
  "Partnership / Business",
  "Other",
] as const;

const contactSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.email().max(254),
  company: z.string().trim().max(160).optional().default(""),
  phone: z.string().trim().max(40).optional().default(""),
  enquiryType: z.enum(ENQUIRY_TYPES),
  message: z.string().trim().min(10).max(5_000),
  consent: z.literal(true).optional(),
  website: z.string().max(0).optional(),
});

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = { "Cache-Control": "no-store", Vary: "Origin" };
  if (isMarketingSiteOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
    headers["Access-Control-Max-Age"] = "600";
  }
  return headers;
}

function reply(origin: string | null, body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: corsHeaders(origin) });
}

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  return new NextResponse(null, { status: isMarketingSiteOrigin(origin) ? 204 : 403, headers: corsHeaders(origin) });
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const limit = await enforcePublicRateLimit({ headers: request.headers, rawToken: "marketing-contact", action: "contact", limit: 5, windowSeconds: 600 });
  if (!limit.allowed) {
    const limited = publicRateLimitResponse(limit);
    Object.entries(corsHeaders(origin)).forEach(([key, value]) => limited.headers.set(key, value));
    return limited;
  }

  const parsed = contactSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return reply(origin, { error: "Please check the form and try again." }, 400);
  // Honeypot filled: accept silently so bots get no signal.
  if (parsed.data.website) return reply(origin, { delivered: true });

  const from = (process.env.CONTACT_EMAIL_FROM ?? process.env.FEEDBACK_EMAIL_FROM)?.trim();
  const to = (process.env.CONTACT_EMAIL_TO ?? process.env.FEEDBACK_EMAIL_TO)?.trim();
  if (!from || !to || !process.env.RESEND_API_KEY?.trim()) {
    return reply(origin, { error: "Our contact form is offline. Please email us directly." }, 503);
  }

  const { name, email, company, phone, enquiryType, message } = parsed.data;
  try {
    await getEmailProvider().send({
      from,
      to: [to],
      replyTo: email,
      subject: `[CollectBoss website] ${enquiryType} — ${company || name}`,
      text: [
        `Enquiry: ${enquiryType}`,
        `Name: ${name}`,
        `Email: ${email}`,
        `Company: ${company || "Not supplied"}`,
        `Phone: ${phone || "Not supplied"}`,
        "",
        message,
      ].join("\n"),
      idempotencyKey: crypto.randomUUID(),
    });
    return reply(origin, { delivered: true });
  } catch {
    return reply(origin, { error: "We couldn't send your message. Please try again or email us directly." }, 502);
  }
}
