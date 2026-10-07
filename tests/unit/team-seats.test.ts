import { describe, expect, it } from "vitest";
import { PLANS, planFeatureLabels } from "@/lib/billing/plans";
import { canAddTeamMember, teamSeatLimitMessage, teamSeatsUsed } from "@/lib/billing/team-seats";

describe("team seats", () => {
  it("counts the owner plus active and invited members", () => {
    expect(teamSeatsUsed(0)).toBe(1);
    expect(teamSeatsUsed(2)).toBe(3);
    expect(teamSeatsUsed(-4)).toBe(1);
  });

  it("blocks invites once the plan limit is reached", () => {
    expect(canAddTeamMember({ used: 1, limit: 1 })).toBe(false);
    expect(canAddTeamMember({ used: 3, limit: 3 })).toBe(false);
    expect(canAddTeamMember({ used: 3, limit: 5 })).toBe(true);
    expect(canAddTeamMember({ used: 500, limit: -1 })).toBe(true);
  });

  it("explains how to get more seats in plain words", () => {
    expect(teamSeatLimitMessage({ limit: 1, extraSeats: 0 }, "Free")).toContain("Upgrade to a paid plan");
    expect(teamSeatLimitMessage({ limit: 3, extraSeats: 0 }, "Boss")).toContain("RM10");
  });

  it("gives the Free plan 10 cases and advertises paid extra users", () => {
    expect(PLANS.free.case_limit).toBe(10);
    expect(planFeatureLabels(PLANS.free).join(" ")).not.toContain("extra user");
    expect(planFeatureLabels(PLANS.boss).join(" ")).toContain("+RM10/month per extra user");
  });
});
