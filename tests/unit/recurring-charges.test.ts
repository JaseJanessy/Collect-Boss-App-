import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { firstRunDate, ordinalDay, recurringChargeSchema, referencePrefixFromLabel } from "@/lib/receivables/recurring";

describe("recurring charges", () => {
  it("starts on the chosen day in the start month, or the next month if that day has passed", () => {
    expect(firstRunDate("2026-10-01", 1)).toBe("2026-10-01");
    expect(firstRunDate("2026-10-15", 1)).toBe("2026-11-01");
    expect(firstRunDate("2026-10-15", 28)).toBe("2026-10-28");
    expect(firstRunDate("2026-12-20", 5)).toBe("2027-01-05");
  });

  it("builds stable invoice reference prefixes from the label", () => {
    expect(referencePrefixFromLabel("Monthly rent, Unit 3A")).toBe("MONTHLY-RENT-UNIT-3A");
    expect(referencePrefixFromLabel("!!!")).toBe("CHARGE");
    const long = referencePrefixFromLabel("A very long description for a retainer fee");
    expect(long.length).toBeLessThanOrEqual(24);
    expect(long.endsWith("-")).toBe(false);
  });

  it("validates schedules with plain messages", () => {
    const base = { account_id: "8f2b4b61-7f0e-4a2c-9d4e-0b8f1f2a3c4d", label: "Rent", amount: "1500", day_of_month: 1, start_date: "2026-10-01" };
    expect(recurringChargeSchema.safeParse(base).success).toBe(true);
    const badDay = recurringChargeSchema.safeParse({ ...base, day_of_month: 31 });
    expect(badDay.success ? "" : badDay.error.issues[0]?.message).toBe("Choose a day from 1 to 28.");
    const badEnd = recurringChargeSchema.safeParse({ ...base, end_date: "2026-09-01" });
    expect(badEnd.success ? "" : badEnd.error.issues[0]?.message).toBe("The end date must be after the start date.");
    expect(ordinalDay(1)).toBe("1st");
    expect(ordinalDay(22)).toBe("22nd");
    expect(ordinalDay(13)).toBe("13th");
  });

  it("generates idempotently and is wired into the hourly job before detection", () => {
    const migration = readFileSync("supabase/migrations/20260920_recurring_charges.sql", "utf8");
    expect(migration).toMatch(/on conflict \(business_id, customer_id, account_id, reference\) do nothing/);
    expect(migration).toMatch(/revoke insert, update, delete on public\.recurring_charges from anon, authenticated/);
    const cron = readFileSync("src/app/api/cron/domain-events/route.ts", "utf8");
    expect(cron.indexOf("recurring_charges_generate")).toBeLessThan(cron.indexOf("domain_events_detect"));
  });
});
