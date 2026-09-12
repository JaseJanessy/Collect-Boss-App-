import { NextResponse } from "next/server";
import { getAuthenticatedBusiness } from "@/lib/debtors/server";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ reportId: string }> },
) {
  const auth = await getAuthenticatedBusiness();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, {
      status: auth.error === "You must be signed in." ? 401 : 503,
    });
  }
  const { reportId } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(reportId)) {
    return NextResponse.json({ error: "Report not found." }, { status: 404 });
  }
  const body = await request.json().catch(() => null) as { action?: unknown; note?: unknown } | null;
  const action = body?.action;
  const note = typeof body?.note === "string" ? body.note.trim() : "";
  if ((action !== "acknowledged" && action !== "resolved") || note.length > 1000) {
    return NextResponse.json({ error: "Choose a valid review action." }, { status: 400 });
  }
  const { data, error } = await auth.client.rpc("payment_access_report_tenant_review", {
    p_report_id: reportId,
    p_action: action,
    p_note: note || null,
  });
  if (error) return NextResponse.json({ error: "Unable to update this report." }, { status: 404 });
  return NextResponse.json({ updated: true, report: data }, {
    headers: { "Cache-Control": "no-store" },
  });
}
