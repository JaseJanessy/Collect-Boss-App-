import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { appendSensitiveAudit } from "@/lib/auth/tenant-access";
import { authorizePocketCapability, requirePocketBillingAccess } from "@/lib/billing/pocket-entitlements";
import { loadPocketDebts } from "@/lib/pocket/ledger-server";
import { workspaceLocalDate } from "@/lib/pocket/ledger";

const schema = z.object({ action: z.enum(["activate","cancel","archive","restore"]), reason: z.string().trim().max(500).optional() });
const headers = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET(_request: NextRequest, context: { params: Promise<{ debtId: string }> }) {
  const access = await requirePocketBillingAccess("case.read");
  if ("code" in access) return NextResponse.json({ error: access.error, code: access.code }, { status: access.status, headers });
  const { debtId } = await context.params;
  try {
    const debt = (await loadPocketDebts(access)).find((item) => item.id === debtId);
    if (!debt) return NextResponse.json({ error: "Debt not found." }, { status: 404, headers });
    const links = await access.service.from("pocket_debt_attachments").select("evidence_id,created_at").eq("business_id", access.businessId).eq("debt_id", debtId).order("created_at", { ascending: false });
    const ids = (links.data ?? []).map((item) => item.evidence_id);
    const files = ids.length ? await access.service.from("evidence_files").select("id,file_name,scan_status,processing_status,uploaded_at").eq("business_id", access.businessId).in("id", ids) : { data: [], error: null };
    return NextResponse.json({ debt, attachments: files.data ?? [] }, { headers });
  } catch { return NextResponse.json({ error: "The debt is temporarily unavailable." }, { status: 503, headers }); }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ debtId: string }> }) {
  const access = await requirePocketBillingAccess("case.manage");
  if ("code" in access) return NextResponse.json({ error: access.error, code: access.code }, { status: access.status, headers });
  const authorization = await authorizePocketCapability({ access, capability: "pocket.debt.manage" });
  if ("error" in authorization) return NextResponse.json({ error: authorization.error, code: authorization.code }, { status: authorization.status, headers });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid debt action." }, { status: 400, headers });
  const { debtId } = await context.params;
  const { data: before } = await access.service.from("obligations").select("id,status,archived_at,paid_minor,outstanding_minor,pocket_due_date").eq("id", debtId).eq("business_id", access.businessId).eq("origin_product_type", "pocket").maybeSingle();
  if (!before) return NextResponse.json({ error: "Debt not found." }, { status: 404, headers });
  if (parsed.data.action === "cancel" && Number(before.paid_minor) > 0) return NextResponse.json({ error: "A debt with payment history cannot be cancelled. Archive it to preserve the allocation history." }, { status: 409, headers });
  const today = workspaceLocalDate(String(access.business.timezone ?? "UTC"));
  const update = parsed.data.action === "archive" ? { archived_at: new Date().toISOString() }
    : parsed.data.action === "restore" ? { archived_at: null }
      : parsed.data.action === "cancel" ? { status: "void" as const }
        : { status: before.pocket_due_date && before.pocket_due_date < today ? "overdue" as const : Number(before.paid_minor) > 0 ? "partial" as const : "open" as const };
  const { error } = await access.service.from("obligations").update({ ...update, updated_at: new Date().toISOString() }).eq("id", debtId).eq("business_id", access.businessId);
  if (error) return NextResponse.json({ error: error.message.includes("LIMIT_REACHED") ? "Your plan's active-debt limit has been reached." : "The debt could not be updated.", code: error.message.includes("LIMIT_REACHED") ? "LIMIT_REACHED" : undefined }, { status: error.message.includes("LIMIT_REACHED") ? 409 : 503, headers });
  await appendSensitiveAudit({ access, request, action: `pocket.debt.${parsed.data.action}d`, entityType: "obligation", entityId: debtId, before: before as Record<string, unknown>, after: update, metadata: { reason: parsed.data.reason ?? null } });
  return NextResponse.json({ ok: true }, { headers });
}
