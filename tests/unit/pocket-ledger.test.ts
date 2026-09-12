import { describe, expect, it } from "vitest";

import { daysOverdue, normalizePocketEmail, normalizePocketPhone, pocketDebtState, workspaceLocalDate } from "@/lib/pocket/ledger";

describe("Pocket customer identity", () => {
  it("normalizes matching fields without changing their display values", () => {
    expect(normalizePocketEmail(" Person@Example.COM ")).toBe("person@example.com");
    expect(normalizePocketPhone("+60 (12) 345-6789")).toBe("60123456789");
  });
});

describe("Pocket simple debt projection", () => {
  const base = { status: "open", archivedAt: null, originalAmountMinor: 10_000, adjustmentsMinor: 0, paidMinor: 0, dueDate: null, today: "2026-08-21" };

  it("does not treat a debt without a due date as overdue", () => {
    expect(pocketDebtState(base)).toBe("active");
  });

  it("uses overdue precedence for a partially paid past-due debt", () => {
    expect(pocketDebtState({ ...base, paidMinor: 1_000, dueDate: "2026-08-19" })).toBe("overdue");
    expect(daysOverdue("2026-08-19", base.today)).toBe(2);
  });

  it("settles explicitly at zero remaining and preserves archive precedence", () => {
    expect(pocketDebtState({ ...base, paidMinor: 10_000 })).toBe("settled");
    expect(pocketDebtState({ ...base, paidMinor: 10_000, archivedAt: "2026-08-21T00:00:00Z" })).toBe("archived");
  });

  it("keeps draft and cancelled mappings deterministic", () => {
    expect(pocketDebtState({ ...base, status: "draft" })).toBe("draft");
    expect(pocketDebtState({ ...base, status: "void" })).toBe("cancelled");
  });

  it("derives the calendar day in the workspace timezone", () => {
    expect(workspaceLocalDate("Asia/Singapore", new Date("2026-08-20T16:30:00Z"))).toBe("2026-08-21");
  });
});
