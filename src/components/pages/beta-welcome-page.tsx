"use client";

import Link from "next/link";
import {
  ShieldCheck,
  Send,
  FileText,
  BarChart2,
  ArrowRight,
  Star,
  Rocket,
  MessageSquarePlus,
} from "lucide-react";

const features = [
  {
    icon: <FileText  className="w-5 h-5 text-[#009966]" />,
    title: "Track every case",
    body:  "Add debtors, record amounts owed, and manage collection stages from one clean dashboard.",
  },
  {
    icon: <Send      className="w-5 h-5 text-[#009966]" />,
    title: "Send reminders instantly",
    body:  "Generate WhatsApp, SMS, or email reminder messages in seconds — personalised for each debtor.",
  },
  {
    icon: <ShieldCheck className="w-5 h-5 text-[#009966]" />,
    title: "Collect payments securely",
    body:  "Lock payment access behind your approval. Debtors submit proofs; you decide what gets confirmed.",
  },
  {
    icon: <BarChart2 className="w-5 h-5 text-[#009966]" />,
    title: "Understand your recovery",
    body:  "Live reports show how much you are owed, recovered, and overdue — all in one place.",
  },
];

const checklist = [
  "Create your first case",
  "Upload first evidence",
  "Generate first reminder",
  "Add receiving account",
  "Turn on payment lock",
  "Record first payment",
];

export function BetaWelcomePage() {
  return (
    <div className="min-h-screen bg-[#F2F4F7] flex flex-col">
      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <div className="bg-[#0D1B3D] px-6 pt-12 pb-16 text-center">
        {/* Beta badge */}
        <span className="inline-flex items-center gap-1.5 bg-[#009966]/20 text-emerald-300 text-[11px] font-bold px-3 py-1 rounded-full mb-5">
          <Star className="w-3 h-3 fill-emerald-300" />
          Private Beta — you&apos;re one of the first users
        </span>

        {/* Wordmark */}
        <h1 className="text-4xl font-black tracking-tight text-white leading-tight mb-3">
          Welcome to{" "}
          <span className="text-[#009966]">CollectBoss</span>
        </h1>
        <p className="text-blue-200 text-base max-w-sm mx-auto leading-relaxed">
          The smart debt collection app built for Malaysian SMEs.
          Collect faster, recover more, stress less.
        </p>

        {/* CTA buttons */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center mt-8">
          <Link
            href="/"
            className="flex items-center justify-center gap-2 bg-[#009966] hover:bg-[#00B377] text-white font-bold px-6 py-3 rounded-2xl transition-colors shadow-lg shadow-emerald-900/30"
          >
            <Rocket className="w-4 h-4" />
            Open the App
            <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            href="/login"
            className="flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 text-white font-bold px-6 py-3 rounded-2xl transition-colors border border-white/20"
          >
            Sign In
          </Link>
        </div>
      </div>

      {/* ── Features ──────────────────────────────────────────────────────── */}
      <div className="px-5 py-10 max-w-2xl mx-auto w-full">
        <h2 className="text-lg font-black text-[#0D1B3D] mb-6 text-center">
          What CollectBoss does
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {features.map((f) => (
            <div
              key={f.title}
              className="bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-4 flex gap-4"
            >
              <div className="w-10 h-10 rounded-xl bg-[#009966]/10 flex items-center justify-center shrink-0">
                {f.icon}
              </div>
              <div>
                <p className="text-sm font-bold text-[#0D1B3D]">{f.title}</p>
                <p className="text-xs text-gray-500 mt-1 leading-relaxed">{f.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Onboarding checklist preview ──────────────────────────────────── */}
      <div className="px-5 pb-10 max-w-2xl mx-auto w-full">
        <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm overflow-hidden">
          <div className="bg-[#009966] px-5 py-4">
            <p className="text-white font-black text-sm">Your Getting Started Checklist</p>
            <p className="text-emerald-100 text-[11px] mt-0.5">
              Complete these 6 steps to get the most out of CollectBoss.
            </p>
          </div>
          <div className="px-5 py-4 flex flex-col gap-3">
            {checklist.map((item, i) => (
              <div key={item} className="flex items-center gap-3">
                <div className="w-6 h-6 rounded-full border-2 border-gray-200 flex items-center justify-center shrink-0">
                  <span className="text-[10px] font-bold text-gray-400">{i + 1}</span>
                </div>
                <p className="text-sm text-gray-700 font-medium">{item}</p>
              </div>
            ))}
          </div>
          <div className="px-5 pb-5">
            <Link
              href="/"
              className="flex items-center justify-center gap-2 w-full bg-[#009966] hover:bg-[#00B377] text-white font-bold text-sm px-4 py-3 rounded-xl transition-colors"
            >
              Start Now <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </div>

      {/* ── Beta feedback note ─────────────────────────────────────────────── */}
      <div className="px-5 pb-10 max-w-2xl mx-auto w-full">
        <div className="bg-amber-50 border border-amber-100 rounded-2xl px-5 py-4 flex gap-4 items-start">
          <MessageSquarePlus className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-amber-800">You are a beta tester</p>
            <p className="text-xs text-amber-700 mt-1 leading-relaxed">
              As one of our first users, your feedback shapes CollectBoss.
              Use the <strong>Beta Feedback</strong> button inside the app
              to share ideas or report bugs — we read every message.
            </p>
          </div>
        </div>
      </div>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <div className="mt-auto pb-8 text-center px-5">
        <p className="text-[11px] text-gray-400 leading-relaxed">
          CollectBoss does not provide legal advice.{" "}
          All debt recovery actions are your responsibility.
        </p>
        <p className="text-[10px] text-gray-300 mt-1">
          © {new Date().getFullYear()} CollectBoss · Private Beta
        </p>
      </div>
    </div>
  );
}
