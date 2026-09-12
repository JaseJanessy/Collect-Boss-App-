import { NextRequest, NextResponse } from "next/server";

import { appendSensitiveAudit } from "@/lib/auth/tenant-access";
import { requirePocketBillingAccess } from "@/lib/billing/pocket-entitlements";
import { pocketInvoiceDraftInputSchema } from "@/lib/pocket/invoices";
import { loadPocketInvoices, pocketInvoiceServerError, savePocketInvoiceDraft } from "@/lib/pocket/invoices-server";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie, Authorization" };

export async function GET() {
  const access = await requirePocketBillingAccess("case.read");
  if ("code" in access) return NextResponse.json({ error: access.error, code: access.code }, { status: access.status, headers });
  try {
    return NextResponse.json({ invoices: await loadPocketInvoices(access) }, { headers });
  } catch (error) {
    const mapped = pocketInvoiceServerError(error); return NextResponse.json({ error: mapped.error, code: mapped.code }, { status: mapped.status, headers });
  }
}

export async function POST(request: NextRequest) {
  const access = await requirePocketBillingAccess("case.manage");
  if ("code" in access) return NextResponse.json({ error: access.error, code: access.code }, { status: access.status, headers });
  const parsed = pocketInvoiceDraftInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the invoice details and try again.", issues: parsed.error.flatten().fieldErrors }, { status: 400, headers });
  const operationKey = request.headers.get("idempotency-key") || crypto.randomUUID();
  try {
    const result = await savePocketInvoiceDraft(access, parsed.data, { operationKey });
    await appendSensitiveAudit({ access, request, action: "pocket.invoice.draft_created", entityType: "pocket_simple_invoice", entityId: result.invoiceId, after: { customerId: parsed.data.customerId, status: "draft" } });
    return NextResponse.json(result, { status: 201, headers });
  } catch (error) {
    const mapped = pocketInvoiceServerError(error); return NextResponse.json({ error: mapped.error, code: mapped.code }, { status: mapped.status, headers });
  }
}

