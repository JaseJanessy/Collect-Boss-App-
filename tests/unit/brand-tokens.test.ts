import { describe, expect, it } from "vitest";

import { brandTokens } from "../../shared/brand-tokens.ts";

function luminance(hex: string): number {
  const channels = hex.replace("#", "").match(/.{2}/g)!.map((part) => Number.parseInt(part, 16) / 255).map((value) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}

function contrast(foreground: string, background: string): number {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}

describe("authoritative CollectBoss Main tokens", () => {
  it("locks the approved identity and required neutral roles", () => {
    expect(brandTokens.brand).toEqual({ navy: "#0D1B3D", green: "#009966" });
    expect(brandTokens.background).toBe("#F6F8FB");
    expect(brandTokens.surface.default).toBe("#FFFFFF");
    expect(brandTokens.text.primary).toBe("#14213D");
    expect(brandTokens.text.secondary).toBe("#667085");
    expect(brandTokens.border.default).toBe("#D9E2EC");
    expect(brandTokens.status.danger).toBe("#D64545");
  });

  it("uses an accessible interaction green instead of brand green for small control text", () => {
    expect(contrast(brandTokens.interaction.primary, brandTokens.surface.default)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(brandTokens.text.primary, brandTokens.background)).toBeGreaterThanOrEqual(4.5);
    expect(brandTokens.interaction.primary).not.toBe(brandTokens.brand.green);
  });

  it("keeps status and chart roles explicit", () => {
    expect(brandTokens.status.success).not.toBe(brandTokens.brand.green);
    expect(new Set(Object.values(brandTokens.chart).slice(0, 5)).size).toBe(5);
  });

  it("defines accessible Pocket action aliases without replacing the brand identity", () => {
    expect(brandTokens.pocket.ink).toBe(brandTokens.brand.navy);
    expect(brandTokens.pocket.action.addDebt).toBe(brandTokens.brand.green);
    expect(contrast(brandTokens.pocket.action.primary, brandTokens.pocket.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(brandTokens.pocket.action.recordPayment, brandTokens.pocket.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(brandTokens.pocket.action.scanReceipt, brandTokens.pocket.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(brandTokens.pocket.action.whoOwesMe, brandTokens.pocket.surface)).toBeGreaterThanOrEqual(4.5);
    expect(brandTokens.pocket.action.overdue).toBe(brandTokens.status.dangerStrong);
  });
});
