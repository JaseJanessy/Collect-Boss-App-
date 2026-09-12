import { NextResponse } from "next/server";
import { Statement2AccessError, Statement2ValidationError, getOwnerStatementDataV2 } from "@/lib/statements/service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  try {
    const statement = await getOwnerStatementDataV2({
      period: searchParams.get("period") ?? "3m",
      type: searchParams.get("type"),
      customerId: searchParams.get("customer"),
      currency: searchParams.get("currency"),
      from: searchParams.get("from"),
      to: searchParams.get("to"),
    });
    return NextResponse.json(statement, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const status = error instanceof Statement2ValidationError ? 400 : error instanceof Statement2AccessError ? 403 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load statement." }, { status });
  }
}
