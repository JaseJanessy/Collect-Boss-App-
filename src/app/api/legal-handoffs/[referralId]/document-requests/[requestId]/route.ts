import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedBusiness } from "@/lib/debtors/server";

export const dynamic = "force-dynamic";

const schema = z.object({
  evidenceIds: z.array(z.string().uuid()).min(1).max(30),
  responseNote: z.string().trim().max(1000).optional(),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ referralId: string; requestId: string }> }) {
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "Select at least one case evidence record." }, { status: 400 });
  const { referralId, requestId } = await params;
  const auth = await getAuthenticatedBusiness();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.error === "You must be signed in." ? 401 : 503 });
  const { data: documentRequest } = await auth.client.from("legal_handoff_document_requests").select("id")
    .eq("id", requestId).eq("referral_id", referralId).eq("business_id", auth.businessId).eq("status", "open").maybeSingle();
  if (!documentRequest) return NextResponse.json({ error: "Document request not found." }, { status: 404 });
  const { data, error } = await auth.client.rpc("legal_handoff_fulfil_document_request", {
    p_request_id: requestId,
    p_evidence_ids: [...new Set(input.data.evidenceIds)],
    p_response_note: input.data.responseNote || null,
  });
  if (error || !data) return NextResponse.json({ error: "Unable to provide the selected documents." }, { status: 409 });
  return NextResponse.json({ documentRequest: data }, { headers: { "Cache-Control": "no-store" } });
}
