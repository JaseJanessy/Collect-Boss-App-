"use client";

/**
 * FeedbackButton — floating bottom-right button for beta feedback & bug reports.
 * Stores submissions in localStorage (no backend required for beta).
 */

import { useState } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  MessageSquarePlus,
  Bug,
  X,
  CheckCircle2,
  ChevronRight,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

type Tab = "feedback" | "bug";

interface Submission {
  type:      string;
  message:   string;
  page?:     string;
  steps?:    string;
  email:     string;
  timestamp: string;
}

const LS_KEY = "cb_beta_feedback";

function saveFeedback(s: Submission) {
  try {
    const existing: Submission[] = JSON.parse(localStorage.getItem(LS_KEY) ?? "[]");
    existing.push(s);
    localStorage.setItem(LS_KEY, JSON.stringify(existing));
  } catch { /* noop */ }
}

// ─── Main component ────────────────────────────────────────────────────────────

export function FeedbackButton() {
  const { user } = useAuth();
  const pathname = usePathname();
  const [open, setOpen]       = useState(false);
  const [tab,  setTab]        = useState<Tab>("feedback");
  const [done, setDone]       = useState(false);

  // Feedback form
  const [fbType,    setFbType]    = useState("suggestion");
  const [fbMessage, setFbMessage] = useState("");

  // Bug form
  const [bugWhat,   setBugWhat]   = useState("");
  const [bugPage,   setBugPage]   = useState("");
  const [bugSteps,  setBugSteps]  = useState("");

  const email = user?.email ?? "";

  // Capability-token debtor journeys must not include account-owner beta UI.
  if (pathname.startsWith("/pay/") || pathname.startsWith("/acknowledge/")) return null;

  function reset() {
    setFbType("suggestion");
    setFbMessage("");
    setBugWhat("");
    setBugPage("");
    setBugSteps("");
    setDone(false);
    setTab("feedback");
  }

  function handleClose() {
    setOpen(false);
    setTimeout(reset, 300);
  }

  function handleSubmit() {
    if (tab === "feedback" && !fbMessage.trim()) return;
    if (tab === "bug"      && !bugWhat.trim())   return;

    saveFeedback({
      type:      tab === "feedback" ? fbType : "bug",
      message:   tab === "feedback" ? fbMessage : bugWhat,
      page:      tab === "bug" ? bugPage  : undefined,
      steps:     tab === "bug" ? bugSteps : undefined,
      email,
      timestamp: new Date().toISOString(),
    });
    setDone(true);
  }

  return (
    <>
      {/* ── Floating trigger ────────────────────────────────────────────── */}
      <button
        onClick={() => setOpen(true)}
        aria-label="Send feedback or report a bug"
        className={cn(
          "cb-feedback-trigger fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-40 md:bottom-6 md:right-6",
          "flex items-center gap-2 bg-[#009966] hover:bg-[#00B377] text-white",
          "min-h-11 text-xs font-bold px-3.5 py-2.5 rounded-full shadow-lg shadow-emerald-900/30",
          "transition-all hover:scale-105 active:scale-95",
          open && "opacity-0 pointer-events-none",
        )}
      >
        <MessageSquarePlus className="w-4 h-4" />
        <span className="hidden sm:inline">Beta Feedback</span>
      </button>

      {/* ── Backdrop ────────────────────────────────────────────────────── */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          onClick={handleClose}
        />
      )}

      {/* ── Modal ───────────────────────────────────────────────────────── */}
      <div
        className={cn(
          "cb-feedback-sheet fixed bottom-0 right-0 z-50 w-full max-w-sm md:max-w-md mx-auto",
          "md:bottom-6 md:right-6 md:mx-0",
          "transition-all duration-300",
          open ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0 pointer-events-none",
        )}
      >
        <div role="dialog" aria-modal="true" aria-labelledby="feedback-dialog-title" className="max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom))] overflow-y-auto rounded-t-3xl bg-white shadow-2xl md:rounded-3xl">
          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100">
            <div>
              <p id="feedback-dialog-title" className="text-sm font-black text-[#0D1B3D]">
                {done ? "Thank you! 🙌" : "Share your feedback"}
              </p>
              {!done && (
                <p className="text-[11px] text-gray-400 mt-0.5">
                  Help us make CollectBoss better.
                </p>
              )}
            </div>
            <button
              onClick={handleClose}
              aria-label="Close feedback dialog"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-gray-100 transition-colors hover:bg-gray-200"
            >
              <X className="w-3.5 h-3.5 text-gray-600" />
            </button>
          </div>

          {done ? (
            // ── Success state ──────────────────────────────────────────────
            <div className="px-5 py-8 flex flex-col items-center gap-3 text-center">
              <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center">
                <CheckCircle2 className="w-7 h-7 text-[#009966]" />
              </div>
              <p className="text-sm font-bold text-gray-800">Feedback received!</p>
              <p className="text-xs text-gray-500 max-w-[220px]">
                We read every submission and use it to improve CollectBoss.
              </p>
              <button
                onClick={handleClose}
                className="mt-2 text-xs font-bold text-[#009966] hover:underline"
              >
                Close
              </button>
            </div>
          ) : (
            <div className="px-5 pb-5 pt-4 flex flex-col gap-4">
              {/* Tabs */}
              <div className="flex gap-2">
                {(["feedback", "bug"] as Tab[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={cn(
                      "flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold border transition-all",
                      tab === t
                        ? "bg-[#0D1B3D] text-white border-[#0D1B3D]"
                        : "bg-white text-gray-600 border-gray-200 hover:border-gray-300",
                    )}
                  >
                    {t === "feedback"
                      ? <><MessageSquarePlus className="w-3.5 h-3.5" /> Send Feedback</>
                      : <><Bug className="w-3.5 h-3.5" /> Report Bug</>
                    }
                  </button>
                ))}
              </div>

              {tab === "feedback" ? (
                // ── Feedback form ────────────────────────────────────────────
                <div className="flex flex-col gap-3">
                  <div>
                    <label className="text-[11px] font-semibold text-gray-600 block mb-1">
                      Type
                    </label>
                    <select
                      value={fbType}
                      onChange={(e) => setFbType(e.target.value)}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 bg-white outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300"
                    >
                      <option value="suggestion">Suggestion / Idea</option>
                      <option value="question">Question</option>
                      <option value="compliment">Compliment</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-gray-600 block mb-1">
                      Message <span className="text-red-400">*</span>
                    </label>
                    <textarea
                      value={fbMessage}
                      onChange={(e) => setFbMessage(e.target.value)}
                      placeholder="Tell us what you think…"
                      rows={3}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 resize-none"
                    />
                  </div>
                </div>
              ) : (
                // ── Bug report form ──────────────────────────────────────────
                <div className="flex flex-col gap-3">
                  <div>
                    <label className="text-[11px] font-semibold text-gray-600 block mb-1">
                      What went wrong? <span className="text-red-400">*</span>
                    </label>
                    <textarea
                      value={bugWhat}
                      onChange={(e) => setBugWhat(e.target.value)}
                      placeholder="Describe the problem…"
                      rows={2}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 resize-none"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-gray-600 block mb-1">
                      Page or feature
                    </label>
                    <input
                      type="text"
                      value={bugPage}
                      onChange={(e) => setBugPage(e.target.value)}
                      placeholder="e.g. Add Case, Payments"
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-gray-600 block mb-1">
                      Steps to reproduce
                    </label>
                    <textarea
                      value={bugSteps}
                      onChange={(e) => setBugSteps(e.target.value)}
                      placeholder="1. Click…&#10;2. Then…"
                      rows={2}
                      className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 resize-none"
                    />
                  </div>
                </div>
              )}

              <button
                onClick={handleSubmit}
                disabled={tab === "feedback" ? !fbMessage.trim() : !bugWhat.trim()}
                className="flex items-center justify-center gap-1.5 w-full bg-[#009966] hover:bg-[#00B377] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold py-2.5 rounded-xl transition-colors"
              >
                Submit <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
