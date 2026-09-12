import { NextRequest, NextResponse } from "next/server";
import { requireTenantPermission } from "@/lib/auth/tenant-access";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await requireTenantPermission("audit.read");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit") ?? 100), 1), 250);
  let query = access.service.from("audit_logs").select("*").eq("business_id", access.businessId)
    .order("created_at", { ascending: false }).limit(limit);
  const entityType = request.nextUrl.searchParams.get("entityType")?.trim();
  if (entityType) query = query.eq("entity_type", entityType.slice(0, 80));
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Unable to load audit history." }, { status: 503 });
  return NextResponse.json({ events: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}
