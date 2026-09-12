import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { appendSensitiveAudit } from "@/lib/auth/tenant-access";
import { requirePocketBillingAccess } from "@/lib/billing/pocket-entitlements";
import { issuePocketInvoice, pocketInvoiceServerError } from "@/lib/pocket/invoices-server";

const schema = z.object({ expectedVersion: z.number().int().positive() }).strict();
const headers = { "Cache-Control": "private, no-store, max-age=0" };

export async function POST(request: NextRequest, context: { params: Promise<{ invoiceId: string }> }) {
  const access = await requirePocketBillingAccess("case.manage");
  if ("code" in access) return NextResponse.json({ error: access.error, code: access.code }, { status: access.status, headers });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "The current invoice version is required." }, { status: 400, headers });
  const { invoiceId } = await context.params;
  try {
    const result = await issuePocketInvoice(access, invoiceId, parsed.data.expectedVersion, request.headers.get("idempotency-key") || crypto.randomUUID());
    await appendSensitiveAudit({ access, request, action: "pocket.invoice.issued", entityType: "pocket_simple_invoice", entityId: invoiceId, after: { invoiceNumber: result.invoiceNumber } });
    return NextResponse.json(result, { headers });
  } catch (error) { const mapped = pocketInvoiceServerError(error); return NextResponse.json({ error: mapped.error, code: mapped.code }, { status: mapped.status, headers }); }
}
