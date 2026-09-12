import { NextRequest, NextResponse } from "next/server";
import { processIntegrationJobs } from "@/lib/integrations/worker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const configured = process.env.CRON_SECRET?.trim();
  const authorization = request.headers.get("authorization");
  if (!configured || authorization !== `Bearer ${configured}`) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const results = await processIntegrationJobs(25);
    return NextResponse.json({ processed: results.length, results }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Integration recovery worker failed." }, { status: 503 });
  }
}
