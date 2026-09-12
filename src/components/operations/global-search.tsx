"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { Search } from "lucide-react";

interface SearchResult {
  result_type: "case" | "customer" | "account" | "obligation";
  result_id: string;
  label: string;
  subtitle: string | null;
  href: string;
}

export function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const resultsId = useId();
  const request = useRef(0);

  useEffect(() => {
    const value = query.trim();
    const version = ++request.current;
    if (value.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
      const response = await fetch(`/api/search?query=${encodeURIComponent(value)}`, { cache: "no-store", signal: controller.signal });
      const payload = await response.json().catch(() => ({})) as { results?: SearchResult[]; error?: string };
      if (version !== request.current) return;
      if (!response.ok) {
        setError(payload.error ?? "Search is unavailable.");
        setResults([]);
      } else {
        setError(null);
        setResults(Array.isArray(payload.results) ? payload.results : []);
      }
      } catch {
        if (controller.signal.aborted || version !== request.current) return;
        setError("Search could not connect. Check your connection and try again.");
        setResults([]);
      } finally {
        if (version === request.current && !controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query]);

  return (
    <div className="relative min-w-0 flex-1" onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
      <input
        type="search"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setResults([]);
          setError(null);
          setLoading(event.target.value.trim().length >= 2);
          if (event.target.value.trim().length < 2) {
            setResults([]);
            setError(null);
          }
        }}
        onFocus={() => setOpen(true)}
        aria-label="Search all operational records"
        aria-controls={open && query.trim().length >= 2 ? resultsId : undefined}
        placeholder="Search customers, cases or invoices"
        className="min-h-11 w-full rounded-lg border border-[var(--cb-border)] bg-[var(--cb-surface)] py-2 pl-9 pr-4 text-sm text-[var(--cb-text-primary)] outline-none placeholder:text-[var(--cb-text-secondary)] focus:border-[var(--cb-focus)] focus:ring-2 focus:ring-[var(--cb-focus)]/30"
      />
      {open && query.trim().length >= 2 && (
        <div id={resultsId} role="region" aria-label="Search results" aria-busy={loading} className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-50 max-h-96 overflow-y-auto rounded-xl border border-gray-200 bg-white p-2 shadow-xl">
          {loading ? <p role="status" className="px-3 py-4 text-sm text-gray-500">Searching records…</p>
            : error ? <p role="alert" className="px-3 py-4 text-sm text-red-700">{error}</p>
            : results.length === 0 ? <p role="status" className="px-3 py-4 text-sm text-gray-500">No matching records.</p>
              : results.map((result) => (
                <Link
                  key={`${result.result_type}:${result.result_id}`}
                  href={result.href}
                  onClick={() => setOpen(false)}
                  className="block min-h-11 rounded-lg px-3 py-2 hover:bg-emerald-50"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate text-sm font-semibold text-gray-900">{result.label}</p>
                    <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase text-gray-500">
                      {result.result_type}
                    </span>
                  </div>
                  {result.subtitle && <p className="mt-0.5 truncate text-xs text-gray-500">{result.subtitle}</p>}
                </Link>
              ))}
        </div>
      )}
    </div>
  );
}
