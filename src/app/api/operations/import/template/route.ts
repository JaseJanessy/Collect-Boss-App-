import { NextResponse } from "next/server";
import { requireTenantPermission } from "@/lib/auth/tenant-access";
import { importTemplateCsv } from "@/lib/imports/operational-import";

export async function GET() {
  const access = await requireTenantPermission("case.read");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  return new NextResponse(importTemplateCsv(), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="collectboss-import-template.csv"',
      "Cache-Control": "private, no-store",
    },
  });
}

