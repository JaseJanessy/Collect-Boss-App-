import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedBusiness } from "@/lib/debtors/server";
import { parseCurrencyToMinor } from "@/lib/financial/money";
import type { DisputeRow, DisputeStatus } from "@/lib/supabase/types";
import { canTransitionDispute } from "@/lib/domain/workflows";

export const dynamic = "force-dynamic";
const transitions = new Set<Exclude<DisputeStatus, "submitted">>([
  "under_review", "information_requested", "partially_accepted", "accepted",
  "rejected", "resolved", "withdrawn",
]);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ caseId: string; disputeId: string }> },
) {
  const { caseId, disputeId } = await params;
  const auth = await getAuthenticatedBusiness("dispute.resolve");
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: 401 });
  const { data: dispute } = await auth.client.from("disputes").select("id,currency,status")
    .eq("id", disputeId).eq("case_id", caseId).eq("business_id", auth.businessId).maybeSingle();
  if (!dispute) return NextResponse.json({ error: "Dispute not found." }, { status: 404 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.status !== "string" || !transitions.has(body.status as Exclude<DisputeStatus, "submitted">)) {
    return NextResponse.json({ error: "Invalid dispute update." }, { status: 400 });
  }
  if (!canTransitionDispute(dispute.status, body.status as DisputeStatus)) {
    return NextResponse.json({ error: `Dispute status cannot move from ${dispute.status} to ${body.status}.` }, { status: 409 });
  }
  let resolutionMinor: bigint | null = null;
  if (typeof body.resolution_amount === "string" && body.resolution_amount.trim()) {
    try { resolutionMinor = parseCurrencyToMinor(body.resolution_amount, (dispute as { currency?: string }).currency ?? "MYR"); }
    catch { return NextResponse.json({ error: "Enter a valid resolution amount." }, { status: 400 }); }
  }
  const { data, error } = await auth.client.rpc("dispute_transition", {
    p_dispute_id: disputeId,
    p_to_status: body.status as Exclude<DisputeStatus, "submitted">,
    p_response: typeof body.response === "string" ? body.response.trim().slice(0, 2000) || null : null,
    p_resolution_amount_minor: resolutionMinor?.toString() ?? null,
  });
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Unable to update dispute." }, { status: 409 });
  return NextResponse.json({ dispute: data as DisputeRow });
}
