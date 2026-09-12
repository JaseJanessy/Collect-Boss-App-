import { NextResponse } from "next/server";
import { getAuthenticatedBusiness } from "@/lib/debtors/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await getAuthenticatedBusiness();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, {
      status: auth.error === "You must be signed in." ? 401 : 503,
    });
  }
  const [{ data: reports, error }, { data: events, error: eventError }] = await Promise.all([
    auth.client.from("payment_access_suspicious_reports")
      .select("id,case_id,category,details,tenant_review_status,platform_review_required,restriction_applied_until,created_at")
      .eq("business_id", auth.businessId)
      .order("created_at", { ascending: false })
      .limit(50),
    auth.client.from("payment_access_report_events")
      .select("id,report_id,event_type,actor_type,note,metadata,created_at")
      .eq("business_id", auth.businessId)
      .eq("audience", "tenant")
      .order("created_at", { ascending: true }),
  ]);
  if (error || eventError) {
    return NextResponse.json({ error: "Unable to load payment-link safety reports." }, { status: 500 });
  }
  return NextResponse.json({ reports: reports ?? [], events: events ?? [] }, {
    headers: { "Cache-Control": "no-store" },
  });
}
