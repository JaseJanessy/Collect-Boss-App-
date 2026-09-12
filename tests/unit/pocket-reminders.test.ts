import { describe, expect, it } from "vitest";
import {
  buildPocketReminderCandidates,
  buildWhatsAppDeepLink,
  defaultPocketReminderToggles,
  normalizeReminderMessage,
  renderPocketReminderTemplate,
  whatsappPhone,
} from "@/lib/pocket/reminders";

const debt = {
  debtId: "11111111-1111-4111-8111-111111111111",
  dueDate: "2026-08-20",
  status: "partial",
  archivedAt: null,
  remainingMinor: 12_345,
  currency: "MYR",
  updatedAt: "2026-08-18T00:00:00.000Z",
  partialPaymentLocalDates: ["2026-08-19", "2026-08-19"],
};

describe("Pocket reminder schedule rules", () => {
  it("projects deterministic due-soon, due-today, overdue and still-overdue dates", () => {
    const candidates = buildPocketReminderCandidates(debt);
    expect(candidates.map((item) => [item.eventType, item.scheduledLocalDate])).toEqual([
      ["due_soon", "2026-08-19"],
      ["due_today", "2026-08-20"],
      ["overdue", "2026-08-21"],
      ["still_overdue", "2026-08-27"],
    ]);
    expect(new Set(candidates.map((item) => item.sourceKey)).size).toBe(candidates.length);
  });

  it("adds at most one optional partial-balance reminder per local payment date", () => {
    const candidates = buildPocketReminderCandidates(debt, { ...defaultPocketReminderToggles, partialBalance: true });
    expect(candidates.filter((item) => item.eventType === "partial_balance")).toEqual([
      expect.objectContaining({ scheduledLocalDate: "2026-08-19", group: "payments" }),
    ]);
  });

  it.each(["paid", "void", "written_off", "draft"])("does not schedule inactive %s debt", (status) => {
    expect(buildPocketReminderCandidates({ ...debt, status })).toEqual([]);
  });

  it("does not schedule settled balances, archived debt, or disabled preferences", () => {
    expect(buildPocketReminderCandidates({ ...debt, remainingMinor: 0 })).toEqual([]);
    expect(buildPocketReminderCandidates({ ...debt, archivedAt: "2026-08-18T00:00:00Z" })).toEqual([]);
    expect(buildPocketReminderCandidates(debt, { ...defaultPocketReminderToggles, enabled: false })).toEqual([]);
  });
});

describe("Pocket WhatsApp handoff", () => {
  it.each(["en", "ms", "zh"] as const)("renders trusted %s template values", (language) => {
    const message = renderPocketReminderTemplate("overdue", language, {
      customerName: "Aisyah\u0000 <script>",
      remainingMinor: 12_345,
      currency: "MYR",
      dueDate: "2026-08-20",
      businessName: "Kedai & Co",
      locale: "en-MY",
    });
    expect(message).toContain("Aisyah <script>");
    expect(message).toContain("MYR");
    expect(message).toContain("123.45");
    expect(message).toContain("Kedai & Co");
    expect(message).not.toContain("\u0000");
  });

  it("normalizes the number and URL-encodes message content without sending it", () => {
    expect(whatsappPhone("+60 12-345 6789")).toBe("60123456789");
    const link = buildWhatsAppDeepLink("+60 12-345 6789", "Hello A&B\nRM 10");
    expect(link).toBe("https://wa.me/60123456789?text=Hello%20A%26B%0ARM%2010");
    expect(link).not.toContain("api.whatsapp.com/send");
  });

  it("rejects unsafe phone shapes and strips message control characters", () => {
    expect(whatsappPhone("0123")).toBeNull();
    expect(() => buildWhatsAppDeepLink("javascript:alert(1)", "Hello")).toThrow(/international-format/);
    expect(normalizeReminderMessage(" Hi\u0000\r\nthere ")).toBe("Hi\nthere");
  });
});
