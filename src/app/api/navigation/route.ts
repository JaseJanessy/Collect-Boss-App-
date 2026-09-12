import { NextResponse } from "next/server";
import { roleHasPermission, tenantPermissions } from "@/lib/auth/permissions";
import { requireTenantPermission } from "@/lib/auth/tenant-access";

export const dynamic = "force-dynamic";

export async function GET() {
  const access = await requireTenantPermission("case.read");
  if ("error" in access) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status, headers: { "Cache-Control": "no-store" } },
    );
  }

  const permissions = tenantPermissions.filter((permission) =>
    roleHasPermission(access.role, permission, access.settings),
  );

  return NextResponse.json(
    { role: access.role, permissions },
    { headers: { "Cache-Control": "no-store" } },
  );
}
