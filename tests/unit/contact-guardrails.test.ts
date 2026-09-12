import { describe, expect, it } from "vitest";
import { evaluateContactGuard, type ContactGuardContext } from "@/lib/communications/guardrails";

function context(overrides: Partial<ContactGuardContext> = {}): ContactGuardContext {
  return {
    case_id: "case-1",
    customer_id: "customer-1",
    timezone: "Asia/Kuala_Lumpur",
    counts: { attempts_24h: 0, attempts_7d: 0, attempts_30d: 0 },
    policy: {
      max_attempts_24h: 2,
      max_attempts_7d: 5,
      max_attempts_30d: 12,
      frequency_mode: "warn",
      preference_mode: "require_override",
      bulk_mode: "exclude",
    },
    preferences: null,
    ...overrides,
  };
}

describe("contact frequency guardrails", () => {
  it("uses real rolling totals in the professional warning copy", () => {
    const evaluation = evaluateContactGuard(context({
      counts: { attempts_24h: 1, attempts_7d: 6, attempts_30d: 8 },
    }), "whatsapp");

    expect(evaluation.warnings).toContain("High contact frequency - 6 attempts in 7 days.");
    expect(evaluation.recommended_action).toBe("No action recommended today.");
    expect(evaluation.has_frequency_warning).toBe(true);
    expect(evaluation.requires_override).toBe(false);
  });

  it("wrong-number and do-not-call preferences change call recommendations", () => {
    const evaluation = evaluateContactGuard(context({
      preferences: {
        id: "preference-1", business_id: "business-1", customer_id: "customer-1",
        preferred_channel: "email", preferred_time_start: null, preferred_time_end: null,
        email_only: false, do_not_call: true, wrong_number: true, invalid_contact: false,
        do_not_email: false, email_invalid: false, email_unsubscribed: false, last_email_bounced_at: null,
        note: "Customer corrected this", documented_at: "2026-07-29T00:00:00Z",
        documented_by: "user-1", created_at: "2026-07-29T00:00:00Z", updated_at: "2026-07-29T00:00:00Z",
      },
    }), "call");

    expect(evaluation.warnings).toContain("This phone number is documented as a wrong number.");
    expect(evaluation.warnings).toContain("Customer preference: do not call.");
    expect(evaluation.recommended_action).toMatch(/No action recommended today/);
    expect(evaluation.requires_override).toBe(true);
  });

  it("bulk preflight excludes warned contacts unless policy explicitly permits an override", () => {
    const base = context({ counts: { attempts_24h: 3, attempts_7d: 3, attempts_30d: 3 } });
    expect(evaluateContactGuard(base, "email", { bulk: true }).bulk_allowed).toBe(false);
    expect(evaluateContactGuard({
      ...base,
      policy: { ...base.policy, bulk_mode: "require_override" },
    }, "email", { bulk: true, overrideProvided: true }).bulk_allowed).toBe(true);
  });

  it("respects an overnight preferred contact window in the customer timezone", () => {
    const preferences = {
      id: "preference-1", business_id: "business-1", customer_id: "customer-1",
      preferred_channel: null, preferred_time_start: "22:00:00", preferred_time_end: "06:00:00",
      email_only: false, do_not_call: false, wrong_number: false, invalid_contact: false,
      do_not_email: false, email_invalid: false, email_unsubscribed: false, last_email_bounced_at: null,
      note: null, documented_at: "2026-07-29T00:00:00Z", documented_by: "user-1",
      created_at: "2026-07-29T00:00:00Z", updated_at: "2026-07-29T00:00:00Z",
    } as const;
    const inside = evaluateContactGuard(context({ preferences }), "email", {
      now: new Date("2026-07-29T15:00:00Z"),
    });
    const outside = evaluateContactGuard(context({ preferences }), "email", {
      now: new Date("2026-07-29T05:00:00Z"),
    });
    expect(inside.has_preference_warning).toBe(false);
    expect(outside.warnings).toContain("Current time is outside the documented preferred contact time.");
  });
});
