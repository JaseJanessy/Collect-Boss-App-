import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { appendSensitiveAudit, requireTenantPermission } from "@/lib/auth/tenant-access";
import { PLANS } from "@/lib/billing/plans";
import { canAddTeamMember, loadTeamSeatUsage, teamSeatLimitMessage } from "@/lib/billing/team-seats";
import type { PlanSlug } from "@/lib/billing/types";

export const dynamic = "force-dynamic";
const inviteSchema = z.object({
  email: z.email().max(254),
  role: z.enum(["admin", "manager", "staff", "viewer"]),
});

export async function GET() {
  const access = await requireTenantPermission("users.manage");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const { data, error } = await access.service.from("business_memberships").select("*")
    .eq("business_id", access.businessId).order("created_at");
  if (error) return NextResponse.json({ error: "Unable to load team members." }, { status: 503 });
  return NextResponse.json({ members: data ?? [], roleSettings: access.settings }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const access = await requireTenantPermission("users.manage");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const parsed = inviteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid email and assignable role." }, { status: 400 });
  const email = parsed.data.email.trim().toLowerCase();
  const seats = await loadTeamSeatUsage(access.service, access.businessId);
  if (!seats) return NextResponse.json({ error: "We couldn't check your team size right now. Please try again." }, { status: 503 });
  if (!canAddTeamMember(seats)) {
    const planName = PLANS[seats.planSlug as PlanSlug]?.name ?? "current";
    return NextResponse.json(
      { error: teamSeatLimitMessage(seats, planName), code: "TEAM_SEAT_LIMIT_REACHED", used: seats.used, limit: seats.limit },
      { status: 403 },
    );
  }
  const { data, error } = await access.service.from("business_memberships").insert({
    business_id: access.businessId, invited_email: email, role: parsed.data.role,
    status: "invited", invited_by: access.user.id,
  }).select("*").single();
  if (error || !data) return NextResponse.json({ error: error?.code === "23505" ? "This person already has an invitation or membership." : "Unable to create invitation." }, { status: 409 });
  await appendSensitiveAudit({
    access, request, action: "team.invitation_created", entityType: "business_membership",
    entityId: data.id, after: { email, role: parsed.data.role, status: "invited" },
  });
  return NextResponse.json({ member: data }, { status: 201 });
}
