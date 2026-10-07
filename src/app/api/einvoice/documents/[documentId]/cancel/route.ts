import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { appendSensitiveAudit, requireTenantPermission } from "@/lib/auth/tenant-access";
import { cancelDocument, MyInvoisError } from "@/lib/einvoice/myinvois-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };

/** Cancels a validated e-Invoice (LHDN allows this within 72 hours of validation). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ documentId: string }> }) {
  const access = await requireTenantPermission("case.manage");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status, headers });
  const parsed = z.object({ reason: z.string().trim().min(3, "Say why you are cancelling.").max(300) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Say why you are cancelling." }, { status: 400, headers });
  const { documentId } = await params;

  const { data } = await access.service.from("einvoice_documents").select("id,uuid,status,validated_at")
    .eq("id", documentId).eq("business_id", access.businessId).maybeSingle();
  const row = data as { id: string; uuid: string | null; status: string; validated_at: string | null } | null;
  if (!row?.uuid || row.status !== "valid") return NextResponse.json({ error: "Only a validated e-Invoice can be cancelled." }, { status: 409, headers });
  if (!row.validated_at || Date.now() - Date.parse(row.validated_at) >= 72 * 3600_000) {
    return NextResponse.json({ error: "LHDN only allows cancelling within 72 hours. Issue a credit note instead." }, { status: 409, headers });
  }
  const { data: profile } = await access.service.from("einvoice_profiles").select("supplier_tin").eq("business_id", access.businessId).maybeSingle();
  const tin = (profile as { supplier_tin?: string } | null)?.supplier_tin;
  if (!tin) return NextResponse.json({ error: "Set up e-Invoicing in Settings first." }, { status: 409, headers });

  try {
    await cancelDocument(tin, row.uuid, parsed.data.reason);
  } catch (error) {
    const message = error instanceof MyInvoisError && error.code === "OperationPeriodOver"
      ? "LHDN only allows cancelling within 72 hours. Issue a credit note instead."
      : "LHDN did not accept the cancellation. Please try again.";
    return NextResponse.json({ error: message }, { status: 409, headers });
  }
  await access.service.from("einvoice_documents").update({ status: "cancelled", cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", row.id);
  await appendSensitiveAudit({
    access, request, action: "einvoice.cancelled", entityType: "einvoice_document", entityId: row.id,
    before: { status: "valid" }, after: { status: "cancelled", reason: parsed.data.reason },
  });
  return NextResponse.json({ cancelled: true }, { headers });
}
