import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/cron/authorization";
import { getServiceClient } from "@/lib/supabase/service-client";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authorization = authorizeCronRequest(request);
  if (authorization === "not_configured") return NextResponse.json({ error: "Operations monitoring is not configured." }, { status: 503 });
  if (authorization !== "authorized") return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const service = await getServiceClient();
  if (!service) return NextResponse.json({ error: "Operations monitoring is unavailable." }, { status: 503 });
  const { data, error } = await service.rpc("document_intake_module_health", { p_now: new Date().toISOString() });
  if (error || !data) return NextResponse.json({ error: "Unable to collect module health." }, { status: 500 });
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
