import { NextRequest, NextResponse } from "next/server";

import { appendSensitiveAudit } from "@/lib/auth/tenant-access";
import { requirePocketBillingAccess } from "@/lib/billing/pocket-entitlements";
import { pocketInvoiceDraftInputSchema } from "@/lib/pocket/invoices";
import { cancelPocketInvoice, loadPocketInvoices, pocketInvoiceServerError, savePocketInvoiceDraft } from "@/lib/pocket/invoices-server";

const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie, Authorization" };

export async function GET(_request: NextRequest, context: { params: Promise<{ invoiceId: string }> }) {
  const access = await requirePocketBillingAccess("case.read");
  if ("code" in access) return NextResponse.json({ error: access.error, code: access.code }, { status: access.status, headers });
  const { invoiceId } = await context.params;
  try {
    const invoice = (await loadPocketInvoices(access, invoiceId))[0];
    return invoice ? NextResponse.json({ invoice }, { headers }) : NextResponse.json({ error: "Invoice not found." }, { status: 404, headers });
  } catch (error) { const mapped = pocketInvoiceServerError(error); return NextResponse.json({ error: mapped.error, code: mapped.code }, { status: mapped.status, headers }); }
}

export async function PUT(request: NextRequest, context: { params: Promise<{ invoiceId: string }> }) {
  const access = await requirePocketBillingAccess("case.manage");
  if ("code" in access) return NextResponse.json({ error: access.error, code: access.code }, { status: access.status, headers });
  const body = await request.json().catch(() => null) as ({ expectedVersion?: unknown } & Record<string, unknown>) | null;
  const expectedVersion = typeof body?.expectedVersion === "number" && Number.isInteger(body.expectedVersion) ? body.expectedVersion : null;
  if (!body || expectedVersion === null) return NextResponse.json({ error: "Invoice version is required." }, { status: 400, headers });
  const { expectedVersion: _version, ...draftBody } = body;
  void _version;
  const parsed = pocketInvoiceDraftInputSchema.safeParse(draftBody);
  if (!parsed.success) return NextResponse.json({ error: "Check the invoice details and try again.", issues: parsed.error.flatten().fieldErrors }, { status: 400, headers });
  const { invoiceId } = await context.params;
  try {
    const result = await savePocketInvoiceDraft(access, parsed.data, { invoiceId, expectedVersion, operationKey: request.headers.get("idempotency-key") || crypto.randomUUID() });
    await appendSensitiveAudit({ access, request, action: "pocket.invoice.draft_updated", entityType: "pocket_simple_invoice", entityId: invoiceId, after: { version: result.version } });
    return NextResponse.json(result, { headers });
  } catch (error) { const mapped = pocketInvoiceServerError(error); return NextResponse.json({ error: mapped.error, code: mapped.code }, { status: mapped.status, headers }); }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ invoiceId: string }> }) {
  const access = await requirePocketBillingAccess("case.manage");
  if ("code" in access) return NextResponse.json({ error: access.error, code: access.code }, { status: access.status, headers });
  const body = await request.json().catch(() => null) as { action?: unknown } | null;
  if (body?.action !== "cancel") return NextResponse.json({ error: "Choose a valid invoice action." }, { status: 400, headers });
  const { invoiceId } = await context.params;
  try {
    const result = await cancelPocketInvoice(access, invoiceId);
    await appendSensitiveAudit({ access, request, action: "pocket.invoice.cancelled", entityType: "pocket_simple_invoice", entityId: invoiceId });
    return NextResponse.json(result, { headers });
  } catch (error) { const mapped = pocketInvoiceServerError(error); return NextResponse.json({ error: mapped.error, code: mapped.code }, { status: mapped.status, headers }); }
}
