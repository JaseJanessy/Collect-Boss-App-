/**
 * LegalShell — shared layout for all public legal pages.
 * Clean white background, navy headings, breadcrumb nav, footer links.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight, ArrowLeft } from "lucide-react";
import { CollectBossWordmark } from "@/components/brand/wordmark";

interface LegalShellProps {
  title:        string;
  /** Short subtitle shown below the title */
  subtitle?:    string;
  /** ISO date string, e.g. "2024-01-01" */
  lastUpdated:  string;
  children:     ReactNode;
}

const legalNav = [
  { href: "/terms",            label: "Terms of Use"       },
  { href: "/privacy",          label: "Privacy Policy"     },
  { href: "/legal-disclaimer", label: "Legal Disclaimer"   },
  { href: "/pdpa-consent",     label: "PDPA Consent"       },
  { href: "/support",          label: "Contact & Support"  },
];

export function LegalShell({ title, subtitle, lastUpdated, children }: LegalShellProps) {
  const formatted = new Date(lastUpdated).toLocaleDateString("en-MY", {
    day: "numeric", month: "long", year: "numeric",
  });

  return (
    <div className="min-h-screen bg-white">
      {/* ── Top nav ──────────────────────────────────────────────────────── */}
      <header className="border-b border-gray-100 bg-white sticky top-0 z-40">
        <div className="max-w-4xl mx-auto px-5 h-14 flex items-center justify-between">
          <Link href="/">
            <CollectBossWordmark compact />
          </Link>
          <Link
            href="/"
            className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-[#0D1B3D] transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to App
          </Link>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-5 py-10">
        <div className="flex flex-col lg:flex-row gap-10">
          {/* ── Sidebar nav ─────────────────────────────────────────────── */}
          <aside className="lg:w-48 shrink-0">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">
              Legal
            </p>
            <nav className="flex flex-col gap-0.5">
              {legalNav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium text-gray-600 hover:bg-gray-50 hover:text-[#0D1B3D] transition-colors group"
                >
                  {item.label}
                  <ChevronRight className="w-3 h-3 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                </Link>
              ))}
            </nav>

            {/* Return to app */}
            <div className="mt-6 pt-6 border-t border-gray-100">
              <Link
                href="/"
                className="flex items-center justify-center gap-1.5 w-full py-2.5 rounded-xl text-xs font-bold bg-[#009966] hover:bg-[#00B377] text-white transition-colors"
              >
                Open App
              </Link>
              <Link
                href="/signup"
                className="flex items-center justify-center gap-1.5 w-full py-2 mt-2 rounded-xl text-xs font-semibold text-gray-500 hover:text-gray-700 transition-colors"
              >
                Sign Up Free
              </Link>
            </div>
          </aside>

          {/* ── Main content ─────────────────────────────────────────────── */}
          <main className="flex-1 min-w-0">
            {/* Page header */}
            <div className="mb-8 pb-6 border-b border-gray-100">
              <h1 className="text-2xl md:text-3xl font-black text-[#0D1B3D] leading-tight mb-2">
                {title}
              </h1>
              {subtitle && (
                <p className="text-sm text-gray-500 leading-relaxed">{subtitle}</p>
              )}
              <p className="text-[11px] text-gray-400 mt-3">
                Last updated: {formatted}
              </p>
            </div>

            {/* Content */}
            <div className="prose-legal">
              {children}
            </div>

            {/* Bottom nav */}
            <div className="mt-12 pt-6 border-t border-gray-100">
              <p className="text-[11px] text-gray-400 mb-3">Other legal documents:</p>
              <div className="flex flex-wrap gap-2">
                {legalNav.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="text-[11px] font-medium text-gray-500 hover:text-[#009966] hover:underline transition-colors"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          </main>
        </div>
      </div>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="border-t border-gray-100 bg-[#F2F4F7] mt-12">
        <div className="max-w-4xl mx-auto px-5 py-6 text-center">
          <p className="text-[11px] text-gray-400 leading-relaxed">
            © {new Date().getFullYear()} CollectBoss. All rights reserved.
            CollectBoss is a software tool, not a law firm.
            All documents are drafts for informational purposes only.
          </p>
          <div className="flex flex-wrap justify-center gap-4 mt-3">
            {legalNav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}

// ─── Prose helpers (used inside the legal pages) ───────────────────────────

export function LegalH2({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-lg font-black text-[#0D1B3D] mt-8 mb-3 pb-2 border-b border-gray-100">
      {children}
    </h2>
  );
}

export function LegalH3({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-sm font-black text-[#0D1B3D] mt-5 mb-2">
      {children}
    </h3>
  );
}

export function LegalP({ children }: { children: ReactNode }) {
  return (
    <p className="text-sm text-gray-700 leading-relaxed mb-3">
      {children}
    </p>
  );
}

export function LegalUL({ children }: { children: ReactNode }) {
  return (
    <ul className="text-sm text-gray-700 leading-relaxed mb-4 space-y-1.5 ml-4 list-disc">
      {children}
    </ul>
  );
}

export function LegalWarning({ children }: { children: ReactNode }) {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4">
      <p className="text-xs font-bold text-amber-800 mb-1">⚠️ Important Notice</p>
      <p className="text-xs text-amber-700 leading-relaxed">{children}</p>
    </div>
  );
}

export function LegalHighlight({ children }: { children: ReactNode }) {
  return (
    <div className="bg-[#0D1B3D]/5 border border-[#0D1B3D]/10 rounded-xl px-4 py-3 mb-4">
      <p className="text-xs text-[#0D1B3D]/80 leading-relaxed">{children}</p>
    </div>
  );
}
