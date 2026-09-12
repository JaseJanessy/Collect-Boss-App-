import { NextRequest, NextResponse } from "next/server";

import { authorizeCronRequest } from "@/lib/cron/authorization";
import { getServiceClient } from "@/lib/supabase/service-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function run(request: NextRequest) {
  const authorization = authorizeCronRequest(request);
  if (authorization === "not_configured") return NextResponse.json({ error: "Pocket billing lifecycle job is not configured." }, { status: 503 });
  if (authorization !== "authorized") return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const service = await getServiceClient();
  if (!service) return NextResponse.json({ error: "Supabase service access is unavailable." }, { status: 503 });
  const { data, error } = await service.rpc("pocket_refresh_lifecycle_states", { p_now: new Date().toISOString() });
  if (error) return NextResponse.json({ error: "Pocket billing lifecycle job failed." }, { status: 500 });
  return NextResponse.json({ transitioned: Number(data ?? 0) }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: NextRequest) { return run(request); }
export async function POST(request: NextRequest) { return run(request); }
