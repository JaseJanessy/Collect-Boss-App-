import { NextRequest, NextResponse } from "next/server";
import { processPaymentOperationOutbox, runAccountingReconciliation } from "@/lib/accounting/sync";
import { authorizeCronRequest } from "@/lib/cron/authorization";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

async function run(request: NextRequest) {
  const authorization = authorizeCronRequest(request);
  if (authorization === "not_configured") return NextResponse.json({ error: "Accounting reconciliation is not configured." }, { status: 503 });
  if (authorization !== "authorized") return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const results = await runAccountingReconciliation(25);
  const paymentOperations = await processPaymentOperationOutbox(50);
  return NextResponse.json({ processed: results.length, results, paymentOperations }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: NextRequest) { return run(request); }
export async function POST(request: NextRequest) { return run(request); }
