import { describe, expect, it } from "vitest";
import { en, ms, navigationGroupLabel, navigationLabel, translate } from "@/lib/i18n/messages";
import { primaryNavigation, secondaryNavigation } from "@collectboss/navigation";

describe("interface translations", () => {
  it("translates every English key into Bahasa Malaysia", () => {
    const missing = Object.keys(en).filter((key) => !(key in ms));
    expect(missing).toEqual([]);
  });

  it("falls back to English and fills placeholders", () => {
    expect(translate("ms", "nav.cases")).toBe("Kes");
    expect(translate("en", "nav.cases")).toBe("Cases");
    expect(translate("ms", "common.retry")).toBe("Cuba Lagi");
  });

  it("has a translation for every navigation item and group", () => {
    const t = (key: Parameters<typeof translate>[1]) => translate("ms", key);
    for (const item of [...primaryNavigation, ...secondaryNavigation]) {
      expect(`nav.${item.id}` in en, item.id).toBe(true);
      expect(navigationLabel(t, item), item.id).not.toBe(item.label);
    }
    expect(navigationGroupLabel(t, "Workspace")).toBe("Ruang Kerja");
    expect(navigationLabel(t, { id: "unknown-item", label: "Fallback" })).toBe("Fallback");
  });
});
