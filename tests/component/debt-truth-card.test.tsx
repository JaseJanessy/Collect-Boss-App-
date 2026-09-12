// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DebtTruthCard } from "@/components/cases/debt-truth-card";
import type { DebtTruthResponse } from "@/lib/debt-truth/api-types";

const response: DebtTruthResponse = {
  balance: {
    id: "version-1", case_id: "case-1", version: 3, currency: "MYR",
    original_principal_minor: "10000", invoiced_amount_minor: "10000",
    approved_adjustments_minor: "0", approved_fees_minor: "100",
    credit_notes_minor: "200", confirmed_payments_minor: "3000",
    disputed_amount_minor: "1000", unverified_amount_minor: "500",
    unverified_credit_minor: "250", confirmed_outstanding_minor: "5900",
    total_displayed_exposure_minor: "7400", overpayment_minor: "0",
    source_fingerprint: "a".repeat(64), explanation_tree: {},
    user_explanation: "Confirmed and non-confirmed amounts are separated.", calculated_at: "2026-08-12T00:00:00Z",
  },
  versions: [], events: [],
};

describe("DebtTruthCard", () => {
  it("visually and textually distinguishes confirmed, disputed, and unverified money", () => {
    render(<DebtTruthCard data={response} loading={false} error={null} currency="MYR" />);
    expect(screen.getByText("Confirmed")).toBeTruthy();
    expect(screen.getByText("Disputed")).toBeTruthy();
    expect(screen.getByText("Unverified")).toBeTruthy();
    expect(screen.getByText("Excluded from confirmed debt")).toBeTruthy();
    expect(screen.getByText(/do not reduce confirmed debt/i)).toBeTruthy();
  });

  it("fails visibly when the canonical ledger is unavailable", () => {
    render(<DebtTruthCard data={null} loading={false} error="Canonical balance unavailable." currency="MYR" />);
    expect(screen.getByText("Canonical balance unavailable.")).toBeTruthy();
  });
});
