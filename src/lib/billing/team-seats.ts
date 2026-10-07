import { PLANS } from "./plans";

/**
 * Team seats include the business owner, who has no membership row, plus
 * every active or still-pending invitation. A limit of -1 means unlimited.
 */
export interface TeamSeatUsage {
  used: number;
  limit: number;
  extraSeats: number;
}

export function teamSeatsUsed(nonOwnerMembers: number): number {
  return 1 + Math.max(0, nonOwnerMembers);
}

export function canAddTeamMember(usage: Pick<TeamSeatUsage, "used" | "limit">): boolean {
  return usage.limit === -1 || usage.used < usage.limit;
}

export function teamSeatLimitMessage(usage: Pick<TeamSeatUsage, "limit" | "extraSeats">, planName: string): string {
  const people = `${usage.limit} ${usage.limit === 1 ? "person" : "people"}`;
  return planName === PLANS.free.name
    ? `Your Free plan includes ${people}. Upgrade to a paid plan to invite your team.`
    : `Your ${planName} plan currently includes ${people}. Add extra team members (RM10 each per month) or upgrade your plan.`;
}

type SeatClient = {
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

/** Reads current seat usage with a service or tenant client. Returns null when unavailable. */
export async function loadTeamSeatUsage(client: SeatClient, businessId: string): Promise<(TeamSeatUsage & { planSlug: string }) | null> {
  const [{ data: entitlement, error: entitlementError }, { count, error: memberError }] = await Promise.all([
    client.from("entitlements").select("*").eq("business_id", businessId).maybeSingle(),
    client.from("business_memberships").select("id", { count: "exact", head: true })
      .eq("business_id", businessId).in("status", ["active", "invited"]).neq("role", "owner"),
  ]);
  if (entitlementError || memberError) return null;
  const row = entitlement as { plan_slug?: string; team_member_limit?: number; extra_seats?: number } | null;
  return {
    planSlug: row?.plan_slug ?? "free",
    limit: typeof row?.team_member_limit === "number" ? row.team_member_limit : PLANS.free.team_member_limit,
    extraSeats: typeof row?.extra_seats === "number" ? row.extra_seats : 0,
    used: teamSeatsUsed(count ?? 0),
  };
}
