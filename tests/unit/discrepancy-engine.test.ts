import { describe, expect, it } from "vitest";
import { detectDiscrepancies, discrepancyCodes } from "@/lib/discrepancies/engine";
import { cleanDiscrepancyFixture, positiveDiscrepancyFixture } from "../fixtures/discrepancy-labelled";

describe("explainable discrepancy detector", () => {
  it("detects every required category and cites both values and sources", () => {
    const findings = detectDiscrepancies(positiveDiscrepancyFixture());
    expect(findings.map((finding) => finding.code).sort()).toEqual([...discrepancyCodes].sort());
    for (const finding of findings) {
      expect(Object.keys(finding.conflictingValues).length).toBeGreaterThan(1);
      expect(finding.sources.length).toBeGreaterThan(0);
      expect(finding.recommendedAction.length).toBeGreaterThan(10);
      expect(finding.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("keeps the labelled clean fixture free of false positives", () => {
    expect(detectDiscrepancies(cleanDiscrepancyFixture())).toEqual([]);
  });

  it("uses deterministic checks before the document-confidence threshold", () => {
    expect(detectDiscrepancies(cleanDiscrepancyFixture(0.69))).toEqual([]);
    const boundary = detectDiscrepancies(cleanDiscrepancyFixture(0.70));
    expect(boundary).toHaveLength(1);
    expect(boundary[0]).toMatchObject({ code: "contract_invoice_conflict", confidence: "medium", confidenceScore: 70 });
  });

  it("does not flag a current equal balance merely because time has passed", () => {
    const fixture = cleanDiscrepancyFixture();
    expect(detectDiscrepancies({ ...fixture, now: "2027-08-12T00:00:00.000Z" })).toEqual([]);
  });

  it("produces stable keys but a changed source fingerprint when values change", () => {
    const initial = detectDiscrepancies(positiveDiscrepancyFixture()).find((item) => item.code === "accounting_sync_difference");
    const changedFixture = positiveDiscrepancyFixture();
    changedFixture.accounting = [{ ...changedFixture.accounting[0], externalAmountMinor: 11_600n }];
    const changed = detectDiscrepancies(changedFixture).find((item) => item.code === "accounting_sync_difference");
    expect(changed?.findingKey).toBe(initial?.findingKey);
    expect(changed?.sourceFingerprint).not.toBe(initial?.sourceFingerprint);
  });
});

