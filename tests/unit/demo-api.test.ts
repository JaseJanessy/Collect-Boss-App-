import { describe, expect, it } from "vitest";
import { DEMO_READ_ONLY_MESSAGE, demoApiResponse } from "@/lib/demo/demo-api";

const now = new Date("2026-10-01T04:00:00.000Z");

describe("demo API responses", () => {
  it("builds dashboard metrics from the sample cases", () => {
    const response = demoApiResponse("/api/dashboard/summary", "GET", now);
    const metrics = (response?.body as { metrics: { totalOutstandingMinor: number; activeCases: number; currencies: string[] } }).metrics;
    expect(response?.status).toBe(200);
    expect(metrics.totalOutstandingMinor).toBeGreaterThan(0);
    expect(metrics.activeCases).toBeGreaterThan(0);
    expect(metrics.currencies).toEqual(["MYR"]);
  });

  it("orders priority work most urgent first and honours the page size", () => {
    const response = demoApiResponse("/api/action-centre?scope=active&pageSize=5", "GET", now);
    const payload = response?.body as { items: Array<{ priority: string }>; page: { hasMore: boolean }; summary: { actionCount: number } };
    expect(payload.items).toHaveLength(5);
    expect(payload.items[0]?.priority).toBe("critical");
    expect(payload.page.hasMore).toBe(payload.summary.actionCount > 5);
  });

  it("refuses demo writes with a plain message and ignores unknown reads", () => {
    expect(demoApiResponse("/api/action-centre/demo-action-1", "PATCH", now)).toEqual({
      status: 409,
      body: { error: DEMO_READ_ONLY_MESSAGE, code: "DEMO_READ_ONLY" },
    });
    expect(demoApiResponse("/api/cases", "GET", now)).toBeUndefined();
    expect(demoApiResponse("/cases", "POST", now)).toBeUndefined();
  });
});
