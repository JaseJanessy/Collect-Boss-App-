import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantPermission } from "@/lib/auth/tenant-access";
import { ComplianceGateError, decideComplianceCheck, evaluationResponse } from "@/lib/compliance/service";
import type { ComplianceApprovalLevel } from "@/lib/compliance/types";

export const dynamic = "force-dynamic";

const schema = z.object({
  decision: z.enum(["approve", "reject", "bypass"]),
  note: z.string().trim().min(10).max(1000),
  professional_validation_reference: z.string().trim().min(5).max(500).optional(),
});

export async function POST(request: NextRequest, { params }: { params: Promise<{ checkId: string }> }) {
  const { checkId } = await params;
  if (!z.uuid().safeParse(checkId).success) return NextResponse.json({ error: "Invalid compliance check ID." }, { status: 400 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A valid decision and reason are required." }, { status: 400 });
  const lookup = await requireTenantPermission("case.read");
  if ("error" in lookup) return NextResponse.json({ error: lookup.error }, { status: lookup.status });
  const { data: check } = await lookup.service.from("compliance_policy_checks").select("required_approval")
    .eq("id", checkId).eq("business_id", lookup.businessId).maybeSingle();
  if (!check) return NextResponse.json({ error: "Compliance check not found." }, { status: 404 });
  if (check.required_approval === "legal" && parsed.data.decision === "approve" && !parsed.data.professional_validation_reference) {
    return NextResponse.json({ error: "Legal-review approval requires a documented professional validation reference." }, { status: 422 });
  }
  const requiredPermission = parsed.data.decision === "bypass"
    ? "compliance.bypass" as const
    : check.required_approval === "legal"
      ? "compliance.approve.legal" as const
      : check.required_approval === "supervisor"
        ? "compliance.approve.supervisor" as const
        : "compliance.approve.agent" as const;
  const access = await requireTenantPermission(requiredPermission);
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const actorLevel: ComplianceApprovalLevel = parsed.data.decision === "bypass" || access.role === "owner" || access.role === "admin"
    ? "legal" : access.role === "manager" ? "supervisor" : "agent";
  try {
    const decision = await decideComplianceCheck(access.service, {
      businessId: access.businessId,
      checkId,
      actorId: access.user.id,
      actorApprovalLevel: actorLevel,
      decision: parsed.data.decision,
      note: parsed.data.professional_validation_reference
        ? `${parsed.data.note} Validation reference: ${parsed.data.professional_validation_reference}`
        : parsed.data.note,
    });
    return NextResponse.json({ decision }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ComplianceGateError) return NextResponse.json(evaluationResponse(error), { status: error.status });
    return NextResponse.json({ error: "Compliance decision failed." }, { status: 503 });
  }
}
