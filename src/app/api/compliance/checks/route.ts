import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantPermission } from "@/lib/auth/tenant-access";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await requireTenantPermission("case.read");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const state = request.nextUrl.searchParams.get("state");
  const caseId = request.nextUrl.searchParams.get("case_id");
  if (state && !z.enum(["approved", "pending", "rejected", "invalidated", "prohibited"]).safeParse(state).success) {
    return NextResponse.json({ error: "Invalid approval state." }, { status: 400 });
  }
  let query = access.service.from("compliance_policy_checks").select("*")
    .eq("business_id", access.businessId).order("created_at", { ascending: false }).limit(200);
  if (state) query = query.eq("approval_state", state as "approved" | "pending" | "rejected" | "invalidated" | "prohibited");
  if (caseId) query = query.eq("case_id", caseId);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Compliance checks could not be loaded." }, { status: 503 });
  return NextResponse.json({ checks: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
}
