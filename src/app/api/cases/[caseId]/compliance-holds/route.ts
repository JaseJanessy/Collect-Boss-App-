import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { appendSensitiveAudit, requireTenantPermission } from "@/lib/auth/tenant-access";
import { ComplianceGateError, createSensitiveCaseHolds } from "@/lib/compliance/service";

export const dynamic = "force-dynamic";

const categories = [
  "identity_theft", "paid_in_full_dispute", "legal_representation", "serious_complaint",
  "vulnerability", "bereavement", "wrong_party",
] as const;
const createSchema = z.object({ category: z.enum(categories), detail: z.string().trim().min(3).max(1000) });
const resolveSchema = z.object({ hold_id: z.uuid(), resolution_note: z.string().trim().min(3).max(1000) });

async function accessCase(caseId: string, permission: "case.read" | "communication.manage" | "compliance.approve.supervisor") {
  const access = await requireTenantPermission(permission);
  if ("error" in access) return access;
  const { data } = await access.service.from("cases").select("id").eq("id", caseId).eq("business_id", access.businessId).maybeSingle();
  return data ? access : { error: "Case not found.", status: 404 } as const;
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const access = await accessCase(caseId, "case.read");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const { data, error } = await access.service.from("compliance_case_holds").select("*")
    .eq("business_id", access.businessId).eq("case_id", caseId).order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Compliance holds could not be loaded." }, { status: 503 });
  return NextResponse.json({ holds: data ?? [], automation_paused: (data ?? []).some((hold) => hold.status === "active") }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const access = await accessCase(caseId, "communication.manage");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a sensitive-case category and document the reason." }, { status: 400 });
  try {
    await createSensitiveCaseHolds(access.service, {
      businessId: access.businessId,
      caseId,
      actorId: access.user.id,
      jurisdiction: typeof access.business.country_code === "string" ? access.business.country_code : "MY",
      actionKind: "other",
      channel: "other",
    }, null, [parsed.data.category], [parsed.data.detail]);
    const { data } = await access.service.from("compliance_case_holds").select("*")
      .eq("business_id", access.businessId).eq("case_id", caseId).eq("category", parsed.data.category).eq("status", "active").single();
    await appendSensitiveAudit({ access, request, action: "compliance.case_paused", entityType: "compliance_case_hold", entityId: data?.id, caseId, metadata: { category: parsed.data.category, detail: parsed.data.detail } });
    return NextResponse.json({ hold: data }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof ComplianceGateError ? error.message : "Sensitive-case hold could not be created." }, { status: error instanceof ComplianceGateError ? error.status : 503 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const access = await accessCase(caseId, "compliance.approve.supervisor");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const parsed = resolveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A hold ID and documented resolution are required." }, { status: 400 });
  const now = new Date().toISOString();
  const { data: hold, error } = await access.service.from("compliance_case_holds").update({
    status: "resolved", resolved_by: access.user.id, resolved_at: now, resolution_note: parsed.data.resolution_note,
  }).eq("id", parsed.data.hold_id).eq("business_id", access.businessId).eq("case_id", caseId).eq("status", "active").select("*").maybeSingle();
  if (error || !hold) return NextResponse.json({ error: "Active compliance hold not found." }, { status: 404 });
  if (hold.action_item_id) {
    await access.service.from("action_centre_items").update({ status: "completed", completed_at: now } as never)
      .eq("id", hold.action_item_id).eq("business_id", access.businessId);
  }
  await appendSensitiveAudit({ access, request, action: "compliance.case_resumed", entityType: "compliance_case_hold", entityId: hold.id, caseId, metadata: { category: hold.category, resolution_note: parsed.data.resolution_note } });
  return NextResponse.json({ hold });
}
