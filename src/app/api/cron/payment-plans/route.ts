import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/cron/authorization";
import { getServiceClient } from "@/lib/supabase/service-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const authorization = authorizeCronRequest(request);
  if (authorization === "not_configured") {
    return NextResponse.json({ error: "Payment-plan scheduler is not configured." }, { status: 503 });
  }
  if (authorization !== "authorized") {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const service = await getServiceClient();
  if (!service) return NextResponse.json({ error: "Supabase service access is unavailable." }, { status: 503 });
  const body = await request.json().catch(() => ({})) as { asOfDate?: unknown };
  const asOfDate = typeof body.asOfDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.asOfDate)
    ? body.asOfDate
    : null;
  const { data, error } = await service.rpc("payment_plan_run_scheduler", {
    p_as_of_date: asOfDate,
    p_due_soon_days: 3,
  });
  if (error) return NextResponse.json({ error: "Payment-plan scheduler failed." }, { status: 500 });
  return NextResponse.json({ processed: data }, { headers: { "Cache-Control": "no-store" } });
}
