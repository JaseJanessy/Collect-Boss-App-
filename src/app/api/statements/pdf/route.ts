import { NextResponse } from "next/server";
import { generateStatementPdf } from "@/lib/pdf/statement-generator";
import { StatementAccessError, StatementValidationError, getOwnerStatementData } from "@/lib/statements/service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  try {
    const statement = await getOwnerStatementData({ period: searchParams.get("period") ?? "3m" });
    const file = generateStatementPdf(statement);
    const body = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="collectboss-statement-${new Date().toISOString().slice(0, 10)}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    const status = error instanceof StatementValidationError ? 400 : error instanceof StatementAccessError ? 403 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to generate statement." }, { status });
  }
}
