"use client";

import { Languages } from "lucide-react";
import { useLanguage } from "@/contexts/language-context";
import type { Locale } from "@/lib/i18n/messages";

const OPTIONS: Array<{ value: Locale; label: string }> = [
  { value: "en", label: "English" },
  { value: "ms", label: "Bahasa Malaysia" },
];

/** English / Bahasa Malaysia choice for menus and screens on this device. */
export function LanguageSetting() {
  const { locale, setLocale } = useLanguage();
  return (
    <div role="radiogroup" aria-label="Language" className="grid grid-cols-2 gap-2">
      {OPTIONS.map(({ value, label }) => {
        const selected = locale === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            lang={value === "ms" ? "ms" : "en"}
            onClick={() => setLocale(value)}
            className={`flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cb-focus)] ${selected ? "border-[var(--cb-action-primary)] bg-[var(--cb-selected-surface)] text-[var(--cb-selected-text)]" : "border-[var(--cb-border)] bg-[var(--cb-surface)] text-[var(--cb-text-secondary)]"}`}
          >
            <Languages className="size-4" aria-hidden="true" />{label}
          </button>
        );
      })}
    </div>
  );
}
