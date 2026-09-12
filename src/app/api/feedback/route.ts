import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getEmailProvider } from "@/lib/email/provider";
import { getServerClient } from "@/lib/supabase/server-client";

export const dynamic = "force-dynamic";

const feedbackSchema = z.object({
  type: z.enum(["suggestion", "question", "compliment", "other", "bug"]),
  message: z.string().trim().min(3).max(4_000),
  page: z.string().trim().max(300).optional(),
  steps: z.string().trim().max(4_000).optional(),
});

export async function POST(request: NextRequest) {
  const client = await getServerClient();
  const { data: { user } } = client
    ? await client.auth.getUser()
    : { data: { user: null } };
  if (!user?.email) {
    return NextResponse.json({ error: "Sign in before sending feedback." }, { status: 401 });
  }

  const parsed = feedbackSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a valid feedback message." }, { status: 400 });
  }

  const from = process.env.FEEDBACK_EMAIL_FROM?.trim();
  const to = process.env.FEEDBACK_EMAIL_TO?.trim();
  if (!from || !to || !process.env.RESEND_API_KEY?.trim()) {
    return NextResponse.json(
      { error: "Feedback delivery is not configured. Please use the support page." },
      { status: 503 },
    );
  }

  const { type, message, page, steps } = parsed.data;
  const text = [
    `Type: ${type}`,
    `From: ${user.email}`,
    `User ID: ${user.id}`,
    `Page: ${page || "Not supplied"}`,
    "",
    message,
    ...(steps ? ["", "Steps to reproduce:", steps] : []),
  ].join("\n");

  try {
    await getEmailProvider().send({
      from,
      to: [to],
      replyTo: user.email,
      subject: `[CollectBoss ${type === "bug" ? "Bug" : "Feedback"}] ${type}`,
      text,
      idempotencyKey: request.headers.get("idempotency-key") ?? crypto.randomUUID(),
    });
    return NextResponse.json({ delivered: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(
      { error: "Feedback could not be delivered. Please try again or use the support page." },
      { status: 502 },
    );
  }
}
