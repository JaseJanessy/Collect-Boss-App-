import { NextResponse } from "next/server";
import { getOwnerReportData, ReportAccessError } from "@/lib/reports/service";

export const runtime = "nodejs";

export async function GET() {
  try {
    const report = await getOwnerReportData();
    return NextResponse.json({ metrics: report.metrics }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load dashboard." }, { status: error instanceof ReportAccessError ? 403 : 500 });
  }
}
