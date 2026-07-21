import { NextResponse } from "next/server";
import { StatementAccessError, StatementValidationError, getOwnerStatementData } from "@/lib/statements/service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  try {
    const statement = await getOwnerStatementData({ period: searchParams.get("period") ?? "3m" });
    return NextResponse.json(statement, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const status = error instanceof StatementValidationError ? 400 : error instanceof StatementAccessError ? 403 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load statement." }, { status });
  }
}
