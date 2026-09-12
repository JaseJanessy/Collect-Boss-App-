import { NextRequest, NextResponse } from "next/server";

import { requirePocketBillingAccess } from "@/lib/billing/pocket-entitlements";
import { pocketInvoiceServerError, recordPocketInvoiceWhatsAppHandoff } from "@/lib/pocket/invoices-server";

const headers = { "Cache-Control": "private, no-store, max-age=0" };

export async function POST(request: NextRequest, context: { params: Promise<{ invoiceId: string }> }) {
  const access = await requirePocketBillingAccess("case.read");
  if ("code" in access) return NextResponse.json({ error: access.error, code: access.code }, { status: access.status, headers });
  const { invoiceId } = await context.params;
  try {
    return NextResponse.json(await recordPocketInvoiceWhatsAppHandoff(access, invoiceId, request.headers.get("idempotency-key") || crypto.randomUUID()), { headers });
  } catch (error) { const mapped = pocketInvoiceServerError(error); return NextResponse.json({ error: mapped.error, code: mapped.code }, { status: mapped.status, headers }); }
}
