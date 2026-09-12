import { NextResponse } from "next/server";
import { requireTenantPermission } from "@/lib/auth/tenant-access";

export const dynamic = "force-dynamic";

export async function GET() {
  const access = await requireTenantPermission("case.read");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const { data, error } = await access.service.from("business_memberships")
    .select("user_id, invited_email, role, status")
    .eq("business_id", access.businessId)
    .eq("status", "active")
    .not("user_id", "is", null)
    .order("role");
  if (error) return NextResponse.json({ error: "Unable to load case owners." }, { status: 503 });
  return NextResponse.json({
    assignees: (data ?? []).map((member) => ({
      id: member.user_id,
      label: member.user_id === access.user.id ? "Me" : member.invited_email ?? `${member.role} member`,
      role: member.role,
    })),
  }, { headers: { "Cache-Control": "private, no-store" } });
}
