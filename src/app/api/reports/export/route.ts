import { getOwnerReportExport, ReportAccessError } from "@/lib/reports/service";
import { sanitizeCsvCell } from "@/lib/reports/metrics";

export const runtime = "nodejs";

export async function GET() {
  try {
    const report = await getOwnerReportExport();
    const encoder = new TextEncoder();
    const rows = report.cases.map((item) => [item.id, item.debtorName, item.invoiceNo, item.dueDate, item.status, (Number(item.contractualDueMinor) / 100).toFixed(2), (Number(item.approvedPaymentMinor) / 100).toFixed(2), (Number(item.outstandingMinor) / 100).toFixed(2)]);
    let index = -1;
    const stream = new ReadableStream<Uint8Array>({ pull(controller) {
      if (index === -1) { index += 1; controller.enqueue(encoder.encode("Case reference,Debtor,Invoice,Due date,Status,Contractual due (MYR),Collected (MYR),Outstanding (MYR)\r\n")); return; }
      const row = rows[index++];
      if (!row) { controller.close(); return; }
      controller.enqueue(encoder.encode(`${row.map(sanitizeCsvCell).join(",")}\r\n`));
    } });
    return new Response(stream, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="collectboss-report-${report.metrics.asOfDate}.csv"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to export report." }, { status: error instanceof ReportAccessError ? 403 : 500 });
  }
}
