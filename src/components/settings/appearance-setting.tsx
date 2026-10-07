"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useT } from "@/contexts/language-context";
import {
  applyThemePreference,
  readThemePreference,
  THEME_CHANGED_EVENT,
  type ThemePreference,
} from "@/lib/ui/theme";

const OPTIONS: Array<{ value: ThemePreference; labelKey: "theme.light" | "theme.dark" | "theme.system"; Icon: typeof Sun }> = [
  { value: "light", labelKey: "theme.light", Icon: Sun },
  { value: "dark", labelKey: "theme.dark", Icon: Moon },
  { value: "system", labelKey: "theme.system", Icon: Monitor },
];

/** Light / Dark / System choice, saved on this device. */
export function AppearanceSetting({ compact = false }: { compact?: boolean }) {
  const [preference, setPreference] = useState<ThemePreference>("light");
  const t = useT();

  useEffect(() => {
    const sync = () => setPreference(readThemePreference());
    void Promise.resolve().then(sync);
    window.addEventListener(THEME_CHANGED_EVENT, sync);
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const onSystemChange = () => {
      if (readThemePreference() === "system") applyThemePreference("system");
    };
    media?.addEventListener?.("change", onSystemChange);
    return () => {
      window.removeEventListener(THEME_CHANGED_EVENT, sync);
      media?.removeEventListener?.("change", onSystemChange);
    };
  }, []);

  return (
    <div role="radiogroup" aria-label="Appearance" className={compact ? "flex gap-1" : "grid grid-cols-3 gap-2"}>
      {OPTIONS.map(({ value, labelKey, Icon }) => {
        const selected = preference === value;
        const label = t(labelKey);
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => applyThemePreference(value)}
            title={label}
            className={`flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cb-focus)] ${selected ? "border-[var(--cb-action-primary)] bg-[var(--cb-selected-surface)] text-[var(--cb-selected-text)]" : "border-[var(--cb-border)] bg-[var(--cb-surface)] text-[var(--cb-text-secondary)]"}`}
          >
            <Icon className="size-4" aria-hidden="true" />
            <span className={compact ? "sr-only" : undefined}>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
