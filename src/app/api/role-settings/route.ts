import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { appendSensitiveAudit, requireTenantPermission } from "@/lib/auth/tenant-access";

export const dynamic = "force-dynamic";
const schema = z.object({
  manager_can_approve_settlements: z.boolean(),
  manager_can_approve_write_offs: z.boolean(),
  manager_can_submit_document_intakes: z.boolean(),
});

export async function PATCH(request: NextRequest) {
  const access = await requireTenantPermission("users.manage");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid manager approval settings." }, { status: 400 });
  const before = access.settings;
  const { data, error } = await access.service.from("business_role_settings").upsert({
    business_id: access.businessId, ...parsed.data, updated_by: access.user.id, updated_at: new Date().toISOString(),
  }).select("*").single();
  if (error || !data) return NextResponse.json({ error: "Unable to update role settings." }, { status: 409 });
  await appendSensitiveAudit({
    access, request, action: "settings.role_approvals_changed", entityType: "business_role_settings",
    entityId: access.businessId, before: { ...before }, after: parsed.data,
  });
  return NextResponse.json({ settings: data });
}
