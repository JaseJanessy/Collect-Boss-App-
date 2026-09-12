import { NextRequest, NextResponse } from "next/server";
import { CALL_OUTCOMES } from "@/lib/communications/model";
import { getAuthenticatedBusiness } from "@/lib/debtors/server";
import type { CommunicationActivityRow, CommunicationStatus, Json } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

const statuses = new Set<CommunicationStatus>([
  "initiated", "sent", "delivered", "read", "replied", "failed", "completed",
]);
const callOutcomes = new Set<string>(CALL_OUTCOMES);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ caseId: string; activityId: string }> },
) {
  const { caseId, activityId } = await params;
  const auth = await getAuthenticatedBusiness();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: 401 });
  const { data: existing, error: lookupError } = await auth.client
    .from("communication_activities")
    .select("id,channel")
    .eq("id", activityId)
    .eq("case_id", caseId)
    .eq("business_id", auth.businessId)
    .maybeSingle();
  if (lookupError) return NextResponse.json({ error: "Unable to load communication activity." }, { status: 503 });
  if (!existing) return NextResponse.json({ error: "Communication activity not found." }, { status: 404 });

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.status !== "string" || !statuses.has(body.status as CommunicationStatus)
    || (body.metadata !== undefined && (!body.metadata || Array.isArray(body.metadata) || typeof body.metadata !== "object"))) {
    return NextResponse.json({ error: "Invalid communication activity update." }, { status: 400 });
  }
  if (existing.channel === "call"
    && body.status === "completed"
    && (typeof body.outcome !== "string" || !callOutcomes.has(body.outcome))) {
    return NextResponse.json({ error: "Choose a valid call outcome." }, { status: 400 });
  }

  const { data, error } = await auth.client.rpc("communication_activity_update", {
    p_activity_id: activityId,
    p_status: body.status as CommunicationStatus,
    p_outcome: typeof body.outcome === "string" ? body.outcome : null,
    p_completed_at: typeof body.completed_at === "string" ? body.completed_at : null,
    p_external_reference: typeof body.external_reference === "string" ? body.external_reference.slice(0, 300) : null,
    p_duration_seconds: typeof body.duration_seconds === "number" ? body.duration_seconds : null,
    p_metadata: (body.metadata ?? {}) as Json,
    p_related_promise_id: typeof body.related_promise_id === "string" ? body.related_promise_id : null,
    p_related_dispute_id: typeof body.related_dispute_id === "string" ? body.related_dispute_id : null,
    p_related_action_id: typeof body.related_action_id === "string" ? body.related_action_id : null,
  });
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Unable to update communication activity." }, { status: 409 });
  }
  return NextResponse.json({ activity: data as CommunicationActivityRow });
}

