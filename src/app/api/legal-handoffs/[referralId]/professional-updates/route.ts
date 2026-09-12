import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServiceClient } from "@/lib/supabase/service-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const schema = z.object({
  idempotencyKey: z.string().uuid(),
  status: z.enum(["submitted", "under_review", "additional_documents_requested", "accepted", "closed"]),
  professionalName: z.string().trim().min(1).max(160),
  professionalFirm: z.string().trim().min(1).max(200),
  message: z.string().trim().max(2000).nullable().optional(),
  requestedDocuments: z.array(z.string().trim().min(1).max(200)).max(30).default([]),
  providerReference: z.string().trim().max(200).nullable().optional(),
});

function authorized(request: NextRequest): boolean {
  const expected = process.env.LEGAL_HANDOFF_WEBHOOK_SECRET ?? "";
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!expected || !provided) return false;
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  return expectedBytes.length === providedBytes.length && timingSafeEqual(expectedBytes, providedBytes);
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ referralId: string }> }) {
  if (!process.env.LEGAL_HANDOFF_WEBHOOK_SECRET) return NextResponse.json({ error: "Professional handoff callbacks are not configured." }, { status: 503 });
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success || (input.data.status === "additional_documents_requested" && (!input.data.message || input.data.requestedDocuments.length === 0))) {
    return NextResponse.json({ error: "Invalid professional handoff update." }, { status: 400 });
  }
  const { referralId } = await params;
  if (!z.string().uuid().safeParse(referralId).success) return NextResponse.json({ error: "Invalid handoff reference." }, { status: 400 });
  const service = await getServiceClient();
  if (!service) return NextResponse.json({ error: "Professional handoff service is unavailable." }, { status: 503 });
  const { data, error } = await service.rpc("legal_handoff_record_professional_update", {
    p_referral_id: referralId,
    p_idempotency_key: input.data.idempotencyKey,
    p_status: input.data.status,
    p_professional_name: input.data.professionalName,
    p_professional_firm: input.data.professionalFirm,
    p_message: input.data.message ?? null,
    p_requested_documents: input.data.requestedDocuments,
    p_provider_reference: input.data.providerReference ?? null,
  });
  if (error) return NextResponse.json({ error: "Unable to record the professional handoff update." }, { status: 409 });
  return NextResponse.json({ update: data }, { headers: { "Cache-Control": "no-store" } });
}
