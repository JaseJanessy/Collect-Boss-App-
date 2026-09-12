// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PocketMark, PocketPageHeader, PocketStatusChip } from "@/components/pocket/pocket-ui";

describe("Pocket UI primitives", () => {
  it("renders one descriptive page heading for route announcements", () => {
    render(<PocketPageHeader id="screen-title" eyebrow="Debt" title="Add Debt" description="Record the amount." />);
    const heading=screen.getByRole("heading",{name:"Add Debt",level:1});
    expect(heading.id).toBe("screen-title");
    expect(screen.getByText("Record the amount.")).toBeTruthy();
  });

  it.each([
    ["Paid","success"],
    ["Overdue","danger"],
    ["Partially paid","warning"],
    ["Draft","neutral"],
  ] as const)("does not communicate %s by colour alone",(label,tone)=>{
    const {container}=render(<PocketStatusChip label={label} tone={tone}/>);
    expect(screen.getByText(label)).toBeTruthy();
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("keeps the decorative Pocket mark out of the accessibility tree",()=>{
    const {container}=render(<PocketMark/>);
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
  });
});
