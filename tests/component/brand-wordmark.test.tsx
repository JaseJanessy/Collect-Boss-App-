// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CollectBossWordmark } from "@/components/brand/wordmark";
import { CollectBossPocketWordmark } from "@/components/brand/pocket-wordmark";

describe("CollectBoss Main wordmark", () => {
  it("uses one accessible label and the approved solid brand roles", () => {
    const { container } = render(<CollectBossWordmark />);
    expect(screen.getByLabelText("CollectBoss")).toBeTruthy();
    const parts = container.querySelectorAll('[aria-hidden="true"]');
    expect(parts[0]?.className).toContain("--cb-brand-navy");
    expect(parts[1]?.className).toContain("--cb-brand-green");
    expect(container.innerHTML).not.toContain("gradient");
  });

  it("keeps the approved colours on dark surfaces by providing clear space", () => {
    const { container } = render(<CollectBossWordmark variant="dark" />);
    const wordmark = container.querySelector('[data-variant="dark"]');
    expect(wordmark?.className).toContain("--cb-surface");
  });

  it("provides a monochrome variant without changing the primary identity", () => {
    const { container } = render(<CollectBossWordmark variant="monochrome" />);
    expect(container.querySelectorAll(".text-current")).toHaveLength(2);
  });
});

describe("CollectBoss Pocket wordmark", () => {
  it("keeps Collect navy and Boss Pocket green without an adjacent icon", () => {
    const { container } = render(<CollectBossPocketWordmark />);
    expect(screen.getByLabelText("CollectBoss Pocket")).toBeTruthy();
    const parts = container.querySelectorAll('[aria-hidden="true"]');
    expect(parts[0]?.textContent).toBe("Collect");
    expect(parts[0]?.className).toContain("--pocket-brand-navy");
    expect(parts[1]?.textContent).toBe("Boss Pocket");
    expect(parts[1]?.className).toContain("--pocket-brand-green");
    expect(container.querySelector("svg,img")).toBeNull();
    expect(container.innerHTML).not.toContain("gradient");
  });
});
