import { NextRequest, NextResponse } from "next/server";

import { authorizePocketCapability, requirePocketBillingAccess } from "@/lib/billing/pocket-entitlements";
import { pocketInvoiceServerError, uploadPocketInvoiceLogo } from "@/lib/pocket/invoices-server";

const headers = { "Cache-Control": "private, no-store, max-age=0" };

export async function POST(request: NextRequest, context: { params: Promise<{ invoiceId: string }> }) {
  const access = await requirePocketBillingAccess("case.manage");
  if ("code" in access) return NextResponse.json({ error: access.error, code: access.code }, { status: access.status, headers });
  const authorization = await authorizePocketCapability({ access, capability: "pocket.invoice.create" });
  if ("error" in authorization) return NextResponse.json({ error: authorization.error, code: authorization.code }, { status: authorization.status, headers });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a PNG or JPEG logo up to 2 MB." }, { status: 400, headers });
  const { invoiceId } = await context.params;
  try { return NextResponse.json(await uploadPocketInvoiceLogo(access, invoiceId, file), { headers }); }
  catch (error) { const mapped = pocketInvoiceServerError(error); return NextResponse.json({ error: mapped.code === "INVOICE_UNAVAILABLE" ? "Choose a valid PNG or JPEG logo up to 2 MB." : mapped.error, code: mapped.code }, { status: mapped.code === "INVOICE_UNAVAILABLE" ? 400 : mapped.status, headers }); }
}
