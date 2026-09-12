import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedBusiness } from "@/lib/debtors/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedBusiness("case.read");
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const query = request.nextUrl.searchParams.get("query")?.trim().slice(0, 160) ?? "";
  if (query.length < 2) {
    return NextResponse.json({ results: [] }, { headers: { "Cache-Control": "private, no-store" } });
  }
  const { data, error } = await auth.client.rpc("global_operational_search", {
    p_business_id: auth.businessId,
    p_query: query,
    p_limit: 20,
  });
  if (error || !data) return NextResponse.json({
    error: error?.code === "PGRST202"
      ? "Global search requires the R16 database migration."
      : "Search is temporarily unavailable.",
  }, { status: 503 });
  return NextResponse.json({ results: data }, { headers: { "Cache-Control": "private, no-store" } });
}

