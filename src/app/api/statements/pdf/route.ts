import { NextResponse } from "next/server";
import { generateStatementPdf } from "@/lib/pdf/statement-generator";
import { Statement2AccessError, Statement2ValidationError, getOwnerStatementDataV2 } from "@/lib/statements/service";
import { getServerClient } from "@/lib/supabase/server-client";

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
    const statementCaseIds = statement.caseReferences ?? [];
    if (statementCaseIds.length > 0) {
      const client = await getServerClient();
      const { data: { user } } = client ? await client.auth.getUser() : { data: { user: null } };
      if (!client || !user || !statement.businessId) throw new Statement2AccessError("Unable to audit statement generation.");
      const { error: auditError } = await client.from("audit_logs").insert(statementCaseIds.map((caseId) => ({
        business_id: statement.businessId!,
        case_id: caseId,
        action: "statement.generated",
        actor_type: "owner",
        actor_id: user.id,
        metadata: {
          statement_type: statement.statementType,
          period: statement.period,
          period_start: statement.periodStart,
          period_end: statement.periodEnd,
        },
      })));
      if (auditError) throw new Statement2AccessError("Unable to audit statement generation.");
    }
    const file = generateStatementPdf(statement);
    const body = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="collectboss-${statement.statementType}-statement-${new Date().toISOString().slice(0, 10)}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    const status = error instanceof Statement2ValidationError ? 400 : error instanceof Statement2AccessError ? 403 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to generate statement." }, { status });
  }
}
