import { NextRequest, NextResponse } from "next/server";
import { appendSensitiveAudit, requireTenantPermission } from "@/lib/auth/tenant-access";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const access = await requireTenantPermission("public_link.manage");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });

  const { id } = await context.params;
  const service = access.service;

  const { data: token } = await service
    .from("public_access_tokens")
    .select("id, case_id")
    .eq("id", id)
    .eq("business_id", access.businessId)
    .maybeSingle();
  if (!token) {
    return NextResponse.json({ error: "Public link not found." }, { status: 404 });
  }

  const { error } = await service
    .from("public_access_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("business_id", access.businessId)
    .is("revoked_at", null);
  if (error) return NextResponse.json({ error: "Unable to revoke public link." }, { status: 500 });

  await appendSensitiveAudit({ access, request, action: "public_link.revoked", entityType: "public_access_token",
    entityId: id, caseId: (token as { case_id: string }).case_id });
  return NextResponse.json({ revoked: true }, { headers: { "Cache-Control": "no-store" } });
}
