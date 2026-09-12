// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Alert, LoadingState } from "@/components/ui/feedback";
import { InputField } from "@/components/ui/form-controls";
import { DataTable, DataTableContainer } from "@/components/ui/data-table";
import { Tabs } from "@/components/ui/tabs";

describe("CollectBoss design-system accessibility contracts", () => {
  it("connects field labels, hints, errors, and invalid state", () => {
    const { rerender } = render(<InputField id="amount" label="Amount" hint="Use the invoice currency." value="" onChange={() => undefined} />);
    const input = screen.getByLabelText("Amount");
    expect(input.getAttribute("aria-describedby")).toBe("amount-help");

    rerender(<InputField id="amount" label="Amount" error="Enter a valid amount." value="" onChange={() => undefined} />);
    expect(screen.getByLabelText("Amount").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("paragraph").textContent).toBe("Enter a valid amount.");
  });

  it("uses an assertive role only for error alerts", () => {
    const { rerender } = render(<Alert tone="warning" title="Review needed">Check the receiving account.</Alert>);
    expect(screen.getByRole("status")).toBeTruthy();
    rerender(<Alert tone="error" title="Submission failed">Try again.</Alert>);
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("exposes tabs with selected state and keyboard-reachable buttons", () => {
    const onChange = vi.fn();
    render(<Tabs label="Case status" value="all" onValueChange={onChange} options={[{ value: "all", label: "All" }, { value: "overdue", label: "Overdue" }]} />);
    expect(screen.getByRole("tab", { name: "All" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: "Overdue" }));
    expect(onChange).toHaveBeenCalledWith("overdue");
  });

  it("makes wide tables a named, focusable scroll region", () => {
    render(<DataTableContainer label="Cases"><DataTable><thead><tr><th>Case</th></tr></thead><tbody><tr><td>CB-1</td></tr></tbody></DataTable></DataTableContainer>);
    const region = screen.getByRole("region", { name: "Cases" });
    expect(region.getAttribute("tabindex")).toBe("0");
    expect(screen.getByRole("table")).toBeTruthy();
  });

  it("labels skeleton loading states for assistive technology", () => {
    render(<LoadingState label="Loading payment history" rows={2} />);
    expect(screen.getByRole("status", { name: "Loading payment history" })).toBeTruthy();
  });
});
