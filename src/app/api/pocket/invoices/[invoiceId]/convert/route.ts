import { NextRequest, NextResponse } from "next/server";

import { appendSensitiveAudit } from "@/lib/auth/tenant-access";
import { requirePocketBillingAccess } from "@/lib/billing/pocket-entitlements";
import { convertPocketInvoiceToDebt, pocketInvoiceServerError } from "@/lib/pocket/invoices-server";

const headers = { "Cache-Control": "private, no-store, max-age=0" };

export async function POST(request: NextRequest, context: { params: Promise<{ invoiceId: string }> }) {
  const access = await requirePocketBillingAccess("case.manage");
  if ("code" in access) return NextResponse.json({ error: access.error, code: access.code }, { status: access.status, headers });
  const { invoiceId } = await context.params;
  try {
    const result = await convertPocketInvoiceToDebt(access, invoiceId, request.headers.get("idempotency-key") || crypto.randomUUID());
    await appendSensitiveAudit({ access, request, action: "pocket.invoice.debt_linked", entityType: "pocket_simple_invoice", entityId: invoiceId, metadata: { debtId: result.debtId } });
    return NextResponse.json(result, { headers });
  } catch (error) { const mapped = pocketInvoiceServerError(error); return NextResponse.json({ error: mapped.error, code: mapped.code }, { status: mapped.status, headers }); }
}
