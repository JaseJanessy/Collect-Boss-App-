import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedBusiness } from "@/lib/debtors/server";
import type { NotificationRow } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

const responseHeaders = { "Cache-Control": "private, no-store" };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ notificationId: string }> },
) {
  const { notificationId } = await context.params;
  if (!UUID_PATTERN.test(notificationId)) {
    return NextResponse.json({ error: "Invalid notification ID." }, { status: 400, headers: responseHeaders });
  }

  const auth = await getAuthenticatedBusiness();
  if ("error" in auth) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.error === "You must be signed in." ? 401 : 503, headers: responseHeaders },
    );
  }

  const body = await request.json().catch(() => null) as { action?: unknown } | null;
  const now = new Date().toISOString();
  const changes = body?.action === "mark_read"
    ? { read_at: now }
    : body?.action === "archive"
      ? { archived_at: now, read_at: now }
      : null;
  if (!changes) {
    return NextResponse.json({ error: "Unsupported notification action." }, { status: 400, headers: responseHeaders });
  }

  const { data, error } = await auth.client
    .from("notifications")
    .update(changes)
    .eq("id", notificationId)
    .eq("business_id", auth.businessId)
    .select("*")
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: "Unable to update notification." }, { status: 500, headers: responseHeaders });
  }
  if (!data) {
    return NextResponse.json({ error: "Notification not found." }, { status: 404, headers: responseHeaders });
  }
  return NextResponse.json({ notification: data as NotificationRow }, { headers: responseHeaders });
}
