// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBadge } from "@/components/ui/status-badge";

describe("StatusBadge", () => {
  it("renders a normalized case status for assistive technology", () => {
    render(<StatusBadge status="payment_promise" />);
    expect(screen.getByText("Payment Promise")).toBeTruthy();
  });

  it("retains an unknown status instead of hiding it", () => {
    render(<StatusBadge status="awaiting_review" />);
    expect(screen.getByText("awaiting_review")).toBeTruthy();
  });
});
