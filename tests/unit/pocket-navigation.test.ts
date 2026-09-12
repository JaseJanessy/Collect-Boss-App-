import { describe, expect, it } from "vitest";

import {
  activePocketNavigation,
  pocketDestinationForPath,
  pocketDestinations,
  pocketPathFromUrl,
  pocketPrimaryNavigation,
} from "@collectboss/pocket-navigation";
import { productHomePath, productOwnsProtectedPath } from "@collectboss/workspace-contracts";

describe("Pocket route ownership", () => {
  it("keeps the five locked primary destinations in one source", () => {
    expect(pocketPrimaryNavigation.map((item) => item.label)).toEqual([
      "Home", "Customers", "Add", "Activity", "More",
    ]);
    expect(new Set(pocketPrimaryNavigation.map((item) => item.href)).size).toBe(5);
  });

  it("assigns every Pocket destination to exactly one primary owner", () => {
    for (const destination of pocketDestinations) {
      expect(activePocketNavigation(destination.href)?.id).toBe(destination.owner);
      expect(pocketDestinationForPath(destination.href)?.id).toBe(destination.id);
    }
  });

  it("accepts only known Pocket deep links", () => {
    expect(pocketPathFromUrl("collectbossmobile://pocket/debts/new")).toBe("/pocket/debts/new");
    expect(pocketPathFromUrl("https://app.collectboss.test/pocket/settings")).toBe("/pocket/settings");
    expect(pocketPathFromUrl("https://app.collectboss.test/cases/secret")).toBeNull();
  });
});

describe("product isolation", () => {
  it("routes Pocket to Pocket and every Main plan to Main", () => {
    expect(productHomePath("pocket")).toBe("/pocket");
    for (const plan of ["solo", "team", "company", "enterprise"]) {
      expect(plan).toBeTruthy();
      expect(productHomePath("main")).toBe("/");
      expect(productOwnsProtectedPath("main", "/cases")).toBe(true);
    }
  });

  it("blocks direct cross-product paths", () => {
    expect(productOwnsProtectedPath("pocket", "/cases")).toBe(false);
    expect(productOwnsProtectedPath("main", "/pocket/customers")).toBe(false);
    expect(productOwnsProtectedPath("pocket", "/pocket/receipts")).toBe(true);
  });
});
