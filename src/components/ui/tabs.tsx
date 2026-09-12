import * as React from "react";
import { cn } from "@/lib/utils";

type TabOption<T extends string> = { value: T; label: string; icon?: React.ReactNode };

function Tabs<T extends string>({ label, value, options, onValueChange, className }: {
  label: string;
  value: T;
  options: TabOption<T>[];
  onValueChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={cn("inline-flex max-w-full gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1", className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          onClick={() => onValueChange(option.value)}
          className={cn("inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-bold text-slate-600", value === option.value && "bg-slate-900 text-white")}
        >
          {option.icon}<span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}

export { Tabs };
export type { TabOption };
