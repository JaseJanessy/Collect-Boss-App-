export type ThemePreference = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "cb-theme";
export const THEME_CHANGED_EVENT = "collectboss:theme-changed";

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function readThemePreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : "light";
  } catch {
    return "light";
  }
}

export function resolveDark(preference: ThemePreference, systemPrefersDark: boolean): boolean {
  return preference === "dark" || (preference === "system" && systemPrefersDark);
}

export function applyThemePreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage can be unavailable (private mode); the choice still applies now.
  }
  const dark = resolveDark(preference, window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
  document.documentElement.classList.toggle("dark", dark);
  window.dispatchEvent(new CustomEvent(THEME_CHANGED_EVENT, { detail: preference }));
}

/**
 * Runs before first paint (inlined in the root layout) so a saved dark theme
 * never flashes light. Defaults to light when nothing is saved.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var p=localStorage.getItem("${THEME_STORAGE_KEY}");var d=p==="dark"||(p==="system"&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches);if(d)document.documentElement.classList.add("dark");}catch(e){}})();`;
