"use client";

import Link from "next/link";
import type { ReactNode } from "react";

interface AuthShellProps {
  children: ReactNode;
  /** Shown below the wordmark on mobile */
  maxWidth?: "sm" | "md";
}

/** Shared outer wrapper for all auth pages */
export function AuthShell({ children, maxWidth = "sm" }: AuthShellProps) {
  const widthClass = maxWidth === "sm" ? "max-w-sm" : "max-w-md";
  return (
    <div className="min-h-screen bg-[#F2F4F7] flex flex-col">
      {/* Top wordmark bar */}
      <header className="bg-white border-b border-gray-100 px-6 py-4">
        <Link href="/">
          <span className="text-xl font-black text-[#0D1B3D]">
            Collect<span className="text-[#009966]">Boss</span>
          </span>
        </Link>
        <p className="text-[11px] text-gray-400 mt-0.5">Collect Smart. Recover Better.</p>
      </header>

      {/* Content */}
      <main className={`flex-1 flex flex-col items-center justify-start py-8 px-4`}>
        <div className={`w-full ${widthClass}`}>
          {children}
        </div>
      </main>
    </div>
  );
}

/** White card used in all auth forms */
export function AuthCard({ children }: { children: ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      {children}
    </div>
  );
}

/** Reusable text field for auth forms */
export function AuthField({
  label,
  type = "text",
  placeholder,
  value,
  onChange,
  error,
  icon,
  hint,
  autoComplete,
}: {
  label: string;
  type?: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  icon?: ReactNode;
  hint?: string;
  autoComplete?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-bold text-gray-700">{label}</label>
      <div className="relative">
        {icon && (
          <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
            {icon}
          </div>
        )}
        <input
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          className={`w-full ${icon ? "pl-10" : "pl-4"} pr-4 py-3.5 border rounded-xl text-sm text-gray-900 placeholder:text-gray-400 outline-none transition-all ${
            error
              ? "border-red-300 focus:ring-2 focus:ring-red-100 bg-red-50"
              : "border-gray-200 focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300"
          }`}
        />
      </div>
      {error && <p className="text-xs text-red-500 ml-1">{error}</p>}
      {hint && !error && <p className="text-[11px] text-gray-400 ml-1">{hint}</p>}
    </div>
  );
}

/** Inline error banner */
export function AuthError({ message }: { message: string }) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-700 font-medium">
      ⚠️ {message}
    </div>
  );
}

/** Inline success banner */
export function AuthSuccess({ message }: { message: string }) {
  return (
    <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-xs text-emerald-700 font-semibold">
      ✓ {message}
    </div>
  );
}
