import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedBusiness } from "@/lib/debtors/server";
import type { NotificationRow } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

const responseHeaders = { "Cache-Control": "private, no-store" };

function errorStatus(error: string) {
  return error === "You must be signed in." ? 401 : 503;
}

export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedBusiness();
  if ("error" in auth) {
    const message = auth.error ?? "Notification service is unavailable.";
    return NextResponse.json({ error: message }, { status: errorStatus(message), headers: responseHeaders });
  }

  const requestedLimit = Number(request.nextUrl.searchParams.get("limit") ?? "20");
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 100) {
    return NextResponse.json({ error: "Notification limit must be between 1 and 100." }, { status: 400, headers: responseHeaders });
  }

  const listQuery = auth.client
    .from("notifications")
    .select("*")
    .eq("business_id", auth.businessId)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(requestedLimit);
  const countQuery = auth.client
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("business_id", auth.businessId)
    .is("archived_at", null)
    .is("read_at", null);
  const [{ data, error }, { count, error: countError }] = await Promise.all([listQuery, countQuery]);

  if (error || countError) {
    return NextResponse.json({ error: "Unable to load notifications." }, { status: 500, headers: responseHeaders });
  }
  return NextResponse.json(
    { notifications: (data ?? []) as NotificationRow[], unreadCount: count ?? 0 },
    { headers: responseHeaders },
  );
}

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedBusiness();
  if ("error" in auth) {
    const message = auth.error ?? "Notification service is unavailable.";
    return NextResponse.json({ error: message }, { status: errorStatus(message), headers: responseHeaders });
  }

  const body = await request.json().catch(() => null) as { action?: unknown } | null;
  if (body?.action !== "mark_all_read") {
    return NextResponse.json({ error: "Unsupported notification action." }, { status: 400, headers: responseHeaders });
  }

  const { data, error } = await auth.client
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("business_id", auth.businessId)
    .is("archived_at", null)
    .is("read_at", null)
    .select("id");
  if (error) {
    return NextResponse.json({ error: "Unable to mark notifications as read." }, { status: 500, headers: responseHeaders });
  }
  return NextResponse.json({ updated: data?.length ?? 0, unreadCount: 0 }, { headers: responseHeaders });
}
