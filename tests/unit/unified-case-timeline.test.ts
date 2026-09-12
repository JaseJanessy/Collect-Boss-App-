import { describe, expect, it } from "vitest";
import { buildCaseTimeline, filterCaseTimeline, type TimelineSourceEvent } from "../../src/lib/timeline/model.ts";

const events: TimelineSourceEvent[] = [
  {
    sourceTable: "cases", sourceId: "case-1", type: "case.created",
    category: "case_changes", occurredAt: "2026-01-01T00:00:00.000Z",
    summary: "Case created", visibility: "customer_visible",
  },
  {
    sourceTable: "audit_logs", sourceId: "note-1", type: "case.internal_note",
    category: "case_changes", occurredAt: "2026-01-03T00:00:00.000Z",
    summary: "Internal note", metadata: { note: "Never expose this" }, visibility: "internal_only",
  },
  {
    sourceTable: "payments", sourceId: "payment-1", type: "financial.payment_approved",
    category: "payments", occurredAt: "2026-01-02T00:00:00.000Z",
    summary: "Payment approved", amountMinor: "5000", visibility: "customer_visible",
  },
];

describe("unified case timeline", () => {
  it("is reverse chronological and references its source records", () => {
    const timeline = buildCaseTimeline(events, "staff");
    expect(timeline.map((item) => item.source_record.table)).toEqual(["audit_logs", "payments", "cases"]);
    expect(timeline[1]?.amount_minor).toBe("5000");
  });

  it("uses deterministic source keys to prevent duplicates", () => {
    const timeline = buildCaseTimeline([...events, events[0]!], "staff");
    expect(timeline).toHaveLength(3);
    expect(new Set(timeline.map((item) => item.id)).size).toBe(3);
  });

  it("removes internal events and metadata from the customer projection", () => {
    const timeline = buildCaseTimeline(events, "customer");
    expect(timeline).toHaveLength(2);
    expect(timeline.some((item) => JSON.stringify(item).includes("Never expose this"))).toBe(false);
    expect(timeline.every((item) => item.visibility === "customer_visible")).toBe(true);
  });

  it("supports the required categories", () => {
    const timeline = buildCaseTimeline(events, "staff");
    expect(filterCaseTimeline(timeline, "payments").map((item) => item.category)).toEqual(["payments"]);
    expect(filterCaseTimeline(timeline, "communication")).toHaveLength(0);
    expect(filterCaseTimeline(timeline, "all")).toHaveLength(timeline.length);
  });
});
