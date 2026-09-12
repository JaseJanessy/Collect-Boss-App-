// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBadge } from "@/components/ui/status-badge";

describe("StatusBadge", () => {
  it("renders a normalized case status for assistive technology", () => {
    render(<StatusBadge status="payment_promise" />);
    expect(screen.getByText("Promise to Pay")).toBeTruthy();
  });

  it("retains an unknown status instead of hiding it", () => {
    render(<StatusBadge status="awaiting_review" />);
    expect(screen.getByText("awaiting review")).toBeTruthy();
  });

  it.each([
    ["verified", "verified"],
    ["pending", "pending"],
    ["disputed", "disputed"],
    ["overdue", "overdue"],
    ["failed", "failed"],
    ["closed", "closed"],
    ["warning", "warning"],
    ["high_risk", "high-risk"],
  ])("shows text and an icon for %s", (status, semantic) => {
    const { container } = render(<StatusBadge status={status} />);
    const badge = container.querySelector('[data-slot="status-badge"]');
    expect(badge?.getAttribute("data-status")).toBe(semantic);
    expect(badge?.querySelector("svg")).toBeTruthy();
    expect(badge?.textContent?.trim().length).toBeGreaterThan(0);
  });
});
