import { describe, expect, it } from "vitest";
import { detectDiscrepancies } from "@/lib/discrepancies/engine";
import { cleanDiscrepancyFixture, positiveDiscrepancyFixture } from "../fixtures/discrepancy-labelled";

describe("discrepancy boundary integration", () => {
  it("keeps clean evidence, ledger, accounting and claim snapshots balance-neutral", () => {
    expect(detectDiscrepancies(cleanDiscrepancyFixture())).toHaveLength(0);
  });

  it("returns reviewable findings without a correction or communication command", () => {
    const findings = detectDiscrepancies(positiveDiscrepancyFixture());
    expect(findings).toHaveLength(8);
    expect(findings.every((finding) => finding.sources.length > 0 && finding.recommendedAction.length > 0)).toBe(true);
    expect(JSON.stringify(findings, (_key, value) => typeof value === "bigint" ? value.toString() : value)).not.toMatch(/send|threat|legal escalation/i);
  });
});
