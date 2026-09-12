import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/cron/authorization";
import { processEvidenceScanQueue } from "@/lib/document-intake/scanning/worker";
import { getServiceClient } from "@/lib/supabase/service-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

async function run(request: NextRequest) {
  const authorization = authorizeCronRequest(request);
  if (authorization === "not_configured") return NextResponse.json({ error: "Document scanning is not configured." }, { status: 503 });
  if (authorization !== "authorized") return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const service = await getServiceClient();
  if (!service) return NextResponse.json({ error: "Document scanning service is unavailable." }, { status: 503 });
  try { return NextResponse.json(await processEvidenceScanQueue(service), { headers: { "Cache-Control": "no-store" } }); }
  catch { return NextResponse.json({ error: "Document scanning failed safely." }, { status: 503 }); }
}

export async function GET(request: NextRequest) { return run(request); }
export async function POST(request: NextRequest) { return run(request); }
