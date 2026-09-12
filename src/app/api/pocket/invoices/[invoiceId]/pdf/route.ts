import { NextRequest, NextResponse } from "next/server";

import { requirePocketBillingAccess } from "@/lib/billing/pocket-entitlements";
import { createPocketInvoicePdf, loadPocketInvoices, pocketInvoiceServerError } from "@/lib/pocket/invoices-server";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie, Authorization" };

export async function GET(request: NextRequest, context: { params: Promise<{ invoiceId: string }> }) {
  const access = await requirePocketBillingAccess("case.read");
  if ("code" in access) return NextResponse.json({ error: access.error, code: access.code }, { status: access.status, headers });
  const { invoiceId } = await context.params;
  try {
    const invoice = (await loadPocketInvoices(access, invoiceId))[0];
    if (!invoice) return NextResponse.json({ error: "Invoice not found." }, { status: 404, headers });
    const file = await createPocketInvoicePdf(access, invoice);
    const disposition = request.nextUrl.searchParams.get("download") === "1" ? "attachment" : "inline";
    const filename = `${invoice.invoiceNumber ?? "pocket-invoice-draft"}.pdf`;
    const body = file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.byteLength) as ArrayBuffer;
    return new NextResponse(body, { headers: { ...headers, "Content-Type": "application/pdf", "Content-Disposition": `${disposition}; filename="${filename}"`, "X-Content-Type-Options": "nosniff" } });
  } catch (error) { const mapped = pocketInvoiceServerError(error); return NextResponse.json({ error: mapped.error, code: mapped.code }, { status: mapped.status, headers }); }
}
