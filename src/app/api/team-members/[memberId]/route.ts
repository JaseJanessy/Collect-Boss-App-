import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { appendSensitiveAudit, requireTenantPermission } from "@/lib/auth/tenant-access";

export const dynamic = "force-dynamic";
const updateSchema = z.object({
  role: z.enum(["admin", "manager", "staff", "viewer"]).optional(),
  status: z.enum(["active", "suspended", "revoked"]).optional(),
}).refine((value) => value.role || value.status);

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ memberId: string }> }) {
  const access = await requireTenantPermission("users.manage");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid role or membership status." }, { status: 400 });
  const { memberId } = await params;
  const { data: before } = await access.service.from("business_memberships").select("*")
    .eq("id", memberId).eq("business_id", access.businessId).maybeSingle();
  if (!before) return NextResponse.json({ error: "Team member not found." }, { status: 404 });
  if (before.role === "owner") return NextResponse.json({ error: "The canonical owner role cannot be changed here." }, { status: 409 });
  const { data, error } = await access.service.from("business_memberships")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("id", memberId).eq("business_id", access.businessId).select("*").single();
  if (error || !data) return NextResponse.json({ error: "Unable to update team member." }, { status: 409 });
  await appendSensitiveAudit({
    access, request, action: parsed.data.role ? "team.role_changed" : "team.membership_status_changed",
    entityType: "business_membership", entityId: memberId,
    before: { role: before.role, status: before.status }, after: { role: data.role, status: data.status },
  });
  return NextResponse.json({ member: data });
}
