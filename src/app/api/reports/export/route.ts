import type { NextRequest } from "next/server";
import { appendSensitiveAudit, requireTenantPermission } from "@/lib/auth/tenant-access";
import { getOwnerReportExport, ReportAccessError } from "@/lib/reports/service";
import { sanitizeCsvCell } from "@/lib/reports/metrics";
import { minorToDecimalString } from "@/lib/financial/money";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const access = await requireTenantPermission("export.run");
    if ("error" in access) {
      return Response.json({ error: access.error }, { status: access.status });
    }
    const report = await getOwnerReportExport();
    const exportId = crypto.randomUUID();
    await appendSensitiveAudit({
      access,
      request,
      action: "report.exported",
      entityType: "report_export",
      entityId: exportId,
      after: {
        format: "csv",
        row_count: report.cases.length,
        as_of_date: report.metrics.asOfDate,
      },
    });
    const encoder = new TextEncoder();
    const rows = report.cases.map((item) => {
      const currency = item.currency ?? "MYR";
      return [item.id, item.debtorName, item.invoiceNo, item.dueDate, item.status, currency, minorToDecimalString(BigInt(item.contractualDueMinor), currency), minorToDecimalString(BigInt(item.approvedPaymentMinor), currency), minorToDecimalString(BigInt(item.outstandingMinor), currency)];
    });
    let index = -1;
    const stream = new ReadableStream<Uint8Array>({ pull(controller) {
      if (index === -1) {
        index += 1;
        controller.enqueue(encoder.encode(
          `${report.metrics.totalsByCurrency.map((group) => `Report totals ${group.currency}: Collected cash ${minorToDecimalString(BigInt(group.totalCollectedMinor), group.currency)}; Credit notes ${minorToDecimalString(BigInt(group.totalCreditNotesMinor), group.currency)}; Other adjustments ${minorToDecimalString(BigInt(group.totalAdjustmentsMinor), group.currency)}; Write-offs ${minorToDecimalString(BigInt(group.totalWriteOffsMinor), group.currency)}; Settlement adjustments ${minorToDecimalString(BigInt(group.totalSettlementAdjustmentsMinor), group.currency)}`).join("\r\n")}\r\nCase reference,Debtor,Invoice,Due date,Status,Currency,Contractual due,Collected cash,Outstanding\r\n`,
        ));
        return;
      }
      const row = rows[index++];
      if (!row) { controller.close(); return; }
      controller.enqueue(encoder.encode(`${row.map(sanitizeCsvCell).join(",")}\r\n`));
    } });
    return new Response(stream, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="collectboss-report-${report.metrics.asOfDate}.csv"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to export report." }, { status: error instanceof ReportAccessError ? 403 : 500 });
  }
}
