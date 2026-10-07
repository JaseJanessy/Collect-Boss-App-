import { describe, expect, it } from "vitest";
import { isThemePreference, resolveDark, THEME_INIT_SCRIPT, THEME_STORAGE_KEY } from "@/lib/ui/theme";

describe("theme preference", () => {
  it("resolves dark only when chosen or when following a dark device", () => {
    expect(resolveDark("light", true)).toBe(false);
    expect(resolveDark("dark", false)).toBe(true);
    expect(resolveDark("system", true)).toBe(true);
    expect(resolveDark("system", false)).toBe(false);
  });

  it("accepts only known values and defaults to light before paint", () => {
    expect(isThemePreference("dark")).toBe(true);
    expect(isThemePreference("blue")).toBe(false);
    expect(THEME_INIT_SCRIPT).toContain(THEME_STORAGE_KEY);
    expect(THEME_INIT_SCRIPT).toContain('classList.add("dark")');
  });
});
