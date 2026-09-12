import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedBusiness } from "@/lib/debtors/server";
import type { ActionCentreItemRow, ActionCentreStatus } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

const responseHeaders = { "Cache-Control": "private, no-store" };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const transitions: Record<string, ActionCentreStatus> = {
  reopen: "open",
  start: "in_progress",
  snooze: "snoozed",
  complete: "completed",
  dismiss: "dismissed",
};

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ actionId: string }> },
) {
  const { actionId } = await context.params;
  if (!UUID_PATTERN.test(actionId)) {
    return NextResponse.json({ error: "Invalid Action Centre item ID." }, { status: 400, headers: responseHeaders });
  }
  const auth = await getAuthenticatedBusiness();
  if ("error" in auth) {
    const message = auth.error ?? "Action Centre is unavailable.";
    return NextResponse.json(
      { error: message },
      { status: message === "You must be signed in." ? 401 : 503, headers: responseHeaders },
    );
  }

  const body = await request.json().catch(() => null) as { action?: unknown; snoozedUntil?: unknown } | null;
  const transition = typeof body?.action === "string" ? transitions[body.action] : undefined;
  if (!transition) {
    return NextResponse.json({ error: "Unsupported Action Centre transition." }, { status: 400, headers: responseHeaders });
  }
  const snoozedUntil = transition === "snoozed" && typeof body?.snoozedUntil === "string"
    ? body.snoozedUntil
    : null;
  if (transition === "snoozed" && (!snoozedUntil || Number.isNaN(new Date(snoozedUntil).getTime()))) {
    return NextResponse.json({ error: "Choose a valid snooze duration." }, { status: 400, headers: responseHeaders });
  }

  const { data, error } = await auth.client.rpc("action_centre_transition", {
    p_action_id: actionId,
    p_transition: transition,
    p_snoozed_until: snoozedUntil,
  });
  if (error || !data) {
    return NextResponse.json(
      { error: "Unable to update Action Centre item. Confirm the action is active and the snooze duration is allowed." },
      { status: 409, headers: responseHeaders },
    );
  }
  const action = data as ActionCentreItemRow;
  if (action.business_id !== auth.businessId) {
    return NextResponse.json({ error: "Action Centre item not found." }, { status: 404, headers: responseHeaders });
  }
  return NextResponse.json({ action }, { headers: responseHeaders });
}
