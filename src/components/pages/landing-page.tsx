"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  FolderOpen,
  Send,
  ShieldCheck,
  FileText,
  Gavel,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  MessageCircle,
  Upload,
  ClipboardList,
  Star,
  Menu,
  X,
  ArrowRight,
  Clock,
  TrendingUp,
  Lock,
} from "lucide-react";

// ─── Navbar ───────────────────────────────────────────────────────────────────

function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);

  const links = [
    { href: "#features",   label: "Features"   },
    { href: "#how",        label: "How It Works"},
    { href: "#pricing",    label: "Pricing"     },
    { href: "#faq",        label: "FAQ"         },
  ];

  return (
    <header className="sticky top-0 z-50 bg-[#10284E]/95 backdrop-blur-sm border-b border-[#244777] shadow-sm">
      <a
        href="#landing-main-content"
        className="sr-only fixed left-3 top-3 z-[100] rounded-md bg-white px-3 py-2 text-sm font-semibold text-[#0D1B3D] shadow focus:not-sr-only"
      >
        Skip to main content
      </a>
      <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link href="/landing" className="text-xl font-black tracking-tight text-white leading-none">
          Collect<span className="text-[#009966]">Boss</span>
        </Link>

        {/* Desktop nav */}
        <nav className="cb-phone-landscape-desktop hidden md:flex items-center gap-6">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-sm font-medium text-gray-600 hover:text-[#0D1B3D] transition-colors"
            >
              {l.label}
            </a>
          ))}
        </nav>

        {/* Desktop CTA */}
        <div className="cb-phone-landscape-desktop hidden md:flex items-center gap-3">
          <Link href="/login" className="text-sm font-semibold text-gray-600 hover:text-[#0D1B3D] transition-colors">
            Sign In
          </Link>
          <Link
            href="/signup"
            className="flex items-center gap-1.5 bg-[#009966] hover:bg-[#00B377] text-white text-sm font-bold px-4 py-2 rounded-xl transition-colors"
          >
            Start Free <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {/* Mobile hamburger */}
        <button
          className="cb-phone-landscape-mobile md:hidden w-9 h-9 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors"
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="Toggle menu"
          aria-controls="landing-mobile-nav"
          aria-expanded={menuOpen}
        >
          {menuOpen ? <X className="w-5 h-5 text-gray-700" /> : <Menu className="w-5 h-5 text-gray-700" />}
        </button>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="cb-phone-landscape-mobile-block md:hidden border-t border-gray-100 bg-white px-5 pb-4">
          <nav id="landing-mobile-nav" className="flex flex-col gap-0 mt-2">
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setMenuOpen(false)}
                className="py-3 text-sm font-medium text-gray-700 border-b border-gray-50 hover:text-[#009966] transition-colors"
              >
                {l.label}
              </a>
            ))}
          </nav>
          <div className="flex flex-col gap-2 mt-4">
            <Link
              href="/login"
              className="w-full text-center py-2.5 text-sm font-semibold text-gray-700 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
            >
              Sign In
            </Link>
            <Link
              href="/signup"
              className="w-full text-center py-2.5 text-sm font-bold text-white bg-[#009966] hover:bg-[#00B377] rounded-xl transition-colors"
            >
              Start Free
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}

// ─── Hero ─────────────────────────────────────────────────────────────────────

function Hero() {
  return (
    <section className="bg-[#0D1B3D] pt-20 pb-28 px-5 text-center relative overflow-hidden">
      {/* Subtle radial glow */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-[#009966] opacity-[0.07] rounded-full blur-3xl" />
      </div>

      <div className="relative max-w-3xl mx-auto">
        {/* Eyebrow tag */}
        <span className="inline-flex items-center gap-1.5 bg-[#009966]/20 text-emerald-300 text-[11px] font-bold px-3 py-1 rounded-full mb-6 tracking-wide uppercase">
          <Star className="w-3 h-3 fill-emerald-300" />
          Built for Malaysian SMEs
        </span>

        {/* Headline */}
        <h1 className="text-4xl md:text-5xl lg:text-6xl font-black text-white leading-[1.08] tracking-tight mb-6">
          Collect overdue payments{" "}
          <span className="text-[#009966]">professionally.</span>
        </h1>

        {/* Sub */}
        <p className="text-base md:text-lg text-blue-200 leading-relaxed max-w-2xl mx-auto mb-10">
          CollectBoss helps Malaysian SMEs record debts, send professional reminders,
          manage payment proof, and prepare recovery documents — all in one place.
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/signup"
            className="flex items-center justify-center gap-2 bg-[#009966] hover:bg-[#00B377] text-white font-bold text-base px-8 py-4 rounded-2xl transition-all shadow-lg shadow-emerald-900/40 hover:shadow-emerald-900/60 hover:scale-[1.02] active:scale-[0.98]"
          >
            Start Free — No Card Needed
            <ArrowRight className="w-4 h-4" />
          </Link>
          <a
            href="#features"
            className="flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 text-white font-semibold text-base px-8 py-4 rounded-2xl transition-colors border border-white/15"
          >
            See How It Works
          </a>
        </div>

        {/* Trust strip */}
        <div className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-blue-300 text-xs font-medium">
          <span className="flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />No credit card required</span>
          <span className="flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />Set up in 5 minutes</span>
          <span className="flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />Made for Malaysia</span>
        </div>
      </div>

      {/* Hero stats ribbon */}
      <div className="relative max-w-3xl mx-auto mt-16 grid grid-cols-3 gap-px bg-white/10 rounded-2xl overflow-hidden">
        {[
          { value: "RM 50K+",  label: "Tracked per user (avg)"     },
          { value: "68%",      label: "Reminder success rate"       },
          { value: "5 min",    label: "Time to first reminder sent" },
        ].map((s) => (
          <div key={s.label} className="bg-[#0D1B3D]/80 px-4 py-5 text-center">
            <p className="text-2xl font-black text-white">{s.value}</p>
            <p className="text-[11px] text-blue-300 mt-1">{s.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── Pain points ──────────────────────────────────────────────────────────────

const painPoints = [
  {
    emoji: "😤",
    title: "Customer keeps delaying payment",
    body:  "They promise to pay \"next week\" every week. You have no formal record of what was agreed.",
  },
  {
    emoji: "😬",
    title: "WhatsApp follow-up feels awkward",
    body:  "Chasing money over WhatsApp is uncomfortable and easy to ignore. You need a professional channel.",
  },
  {
    emoji: "🗂️",
    title: "Evidence is scattered everywhere",
    body:  "Invoices in email, DOs on WhatsApp, receipts in a drawer. When you need them, you cannot find them.",
  },
  {
    emoji: "📋",
    title: "No proper payment record",
    body:  "You are not sure who paid what, and when. Disputes happen because there is no single source of truth.",
  },
];

function PainPoints() {
  return (
    <section className="py-20 px-5 bg-white">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <p className="text-xs font-bold text-[#009966] uppercase tracking-widest mb-3">Sound familiar?</p>
          <h2 className="text-3xl md:text-4xl font-black text-[#0D1B3D] leading-tight">
            Running after debtors is exhausting.
          </h2>
          <p className="text-gray-500 mt-3 max-w-xl mx-auto text-base">
            Most Malaysian SMEs lose money not because the debt is uncollectable —
            but because they lack the tools to follow through professionally.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {painPoints.map((p) => (
            <div
              key={p.title}
              className="flex gap-4 p-5 bg-red-50/60 border border-red-100 rounded-2xl"
            >
              <span className="text-2xl shrink-0 mt-0.5">{p.emoji}</span>
              <div>
                <p className="text-sm font-bold text-gray-900 mb-1">{p.title}</p>
                <p className="text-xs text-gray-500 leading-relaxed">{p.body}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Bridge */}
        <div className="mt-10 flex items-center justify-center gap-3 text-center">
          <div className="h-px flex-1 bg-gradient-to-r from-transparent to-gray-200" />
          <p className="text-sm font-bold text-[#0D1B3D] shrink-0">CollectBoss solves all of this.</p>
          <div className="h-px flex-1 bg-gradient-to-l from-transparent to-gray-200" />
        </div>
      </div>
    </section>
  );
}

// ─── Features ─────────────────────────────────────────────────────────────────

const features = [
  {
    icon:   <FolderOpen    className="w-6 h-6" />,
    accent: "text-[#009966] bg-emerald-50",
    title:  "Case Tracking",
    body:   "Create a case for every debtor. Log amounts owed, due dates, invoice numbers, and status updates. Never lose track of who owes you what.",
    tag:    "Core",
  },
  {
    icon:   <MessageCircle className="w-6 h-6" />,
    accent: "text-blue-600 bg-blue-50",
    title:  "Professional Reminders",
    body:   "Generate polite, firm, or final-notice reminder messages in Bahasa Malaysia or English. Copy and send via WhatsApp or SMS in seconds.",
    tag:    "68% success rate",
  },
  {
    icon:   <Lock          className="w-6 h-6" />,
    accent: "text-purple-600 bg-purple-50",
    title:  "Payment Lock",
    body:   "Debtors request access to your payment details. You approve before they see your bank account or DuitNow — zero risk of unauthorised transfers.",
    tag:    "Security",
  },
  {
    icon:   <ClipboardList className="w-6 h-6" />,
    accent: "text-amber-600 bg-amber-50",
    title:  "Evidence Pack",
    body:   "Upload invoices, delivery orders, contracts, and photos. Export everything as a stamped PDF evidence pack, ready for a lawyer or court.",
    tag:    "Legal ready",
  },
  {
    icon:   <FileText      className="w-6 h-6" />,
    accent: "text-orange-600 bg-orange-50",
    title:  "Formal Demand Draft",
    body:   "Generate a formal letter of demand with one click — professional tone, proper Malaysian formatting, ready to send or hand to a solicitor.",
    tag:    "Legal",
  },
  {
    icon:   <CheckCircle2  className="w-6 h-6" />,
    accent: "text-emerald-600 bg-emerald-50",
    title:  "Payment Proof Review",
    body:   "Debtors upload their payment screenshot. You verify and approve before marking the case settled. No more he-said-she-said disputes.",
    tag:    "Dispute proof",
  },
];

function Features() {
  return (
    <section id="features" className="py-20 px-5 bg-[#F2F4F7]">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <p className="text-xs font-bold text-[#009966] uppercase tracking-widest mb-3">Features</p>
          <h2 className="text-3xl md:text-4xl font-black text-[#0D1B3D] leading-tight">
            Everything you need to collect confidently.
          </h2>
          <p className="text-gray-500 mt-3 max-w-xl mx-auto text-base">
            Built specifically for Malaysian SME cash flow realities — DuitNow, WhatsApp, Bahasa Malaysia, and all.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {features.map((f) => (
            <div key={f.title} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex flex-col gap-4">
              <div className="flex items-start justify-between">
                <div className={cn("w-11 h-11 rounded-xl flex items-center justify-center shrink-0", f.accent)}>
                  {f.icon}
                </div>
                <span className="text-[10px] font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                  {f.tag}
                </span>
              </div>
              <div>
                <p className="text-sm font-black text-[#0D1B3D] mb-1.5">{f.title}</p>
                <p className="text-xs text-gray-500 leading-relaxed">{f.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── How it works ─────────────────────────────────────────────────────────────

const steps = [
  {
    n:    "1",
    icon: <FolderOpen  className="w-5 h-5 text-white" />,
    title:"Create a case",
    body: "Add your debtor — name, company, amount owed, due date, and invoice number. Takes under 2 minutes.",
  },
  {
    n:    "2",
    icon: <Upload      className="w-5 h-5 text-white" />,
    title:"Upload evidence",
    body: "Attach invoices, DOs, contracts, and chat screenshots directly to the case. All in one place.",
  },
  {
    n:    "3",
    icon: <Send        className="w-5 h-5 text-white" />,
    title:"Send a reminder",
    body: "Generate a professional reminder message and copy it to WhatsApp or SMS in seconds.",
  },
  {
    n:    "4",
    icon: <ShieldCheck className="w-5 h-5 text-white" />,
    title:"Review payment",
    body: "Debtor submits proof. You verify and approve before the balance updates. Full audit trail.",
  },
  {
    n:    "5",
    icon: <Gavel       className="w-5 h-5 text-white" />,
    title:"Export documents",
    body: "Generate a formal demand letter or evidence pack PDF — ready for a lawyer or the Tribunal Tuntutan Pengguna.",
  },
];

function HowItWorks() {
  return (
    <section id="how" className="py-20 px-5 bg-white">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-14">
          <p className="text-xs font-bold text-[#009966] uppercase tracking-widest mb-3">How it works</p>
          <h2 className="text-3xl md:text-4xl font-black text-[#0D1B3D]">Simple 5-step process.</h2>
          <p className="text-gray-500 mt-3 max-w-lg mx-auto text-base">
            From onboarding to your first reminder in under 10 minutes.
          </p>
        </div>

        {/* Steps — vertical timeline on mobile, horizontal on md+ */}
        <div className="flex flex-col md:flex-row gap-0 md:gap-0 relative">
          {/* Connector line (desktop) */}
          <div className="hidden md:block absolute top-6 left-[calc(10%+20px)] right-[calc(10%+20px)] h-0.5 bg-gradient-to-r from-[#009966] to-[#0D1B3D] opacity-20" />

          {steps.map((s, i) => (
            <div key={s.n} className="flex-1 flex flex-col items-center text-center px-3">
              {/* Mobile: connecting line */}
              {i > 0 && (
                <div className="md:hidden w-0.5 h-8 bg-gradient-to-b from-[#009966] to-[#0D1B3D] opacity-20 mb-0" />
              )}

              {/* Circle */}
              <div className="relative z-10 w-12 h-12 rounded-full bg-[#009966] flex items-center justify-center shadow-md shadow-emerald-200 mb-4 shrink-0">
                {s.icon}
                <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-[#0D1B3D] text-white text-[9px] font-black flex items-center justify-center border-2 border-white">
                  {s.n}
                </span>
              </div>

              <p className="text-sm font-black text-[#0D1B3D] mb-1.5">{s.title}</p>
              <p className="text-xs text-gray-500 leading-relaxed max-w-[160px] mx-auto">{s.body}</p>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="mt-14 text-center">
          <Link
            href="/signup"
            className="inline-flex items-center gap-2 bg-[#009966] hover:bg-[#00B377] text-white font-bold text-sm px-7 py-3.5 rounded-2xl transition-all shadow-md shadow-emerald-200/60 hover:shadow-emerald-200"
          >
            Get Started Free <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}

// ─── Pricing ──────────────────────────────────────────────────────────────────

const plans = [
  {
    name:     "Free",
    price:    "RM 0",
    period:   "forever",
    desc:     "For SMEs just getting started.",
    color:    "border-gray-200",
    badge:    null,
    features: [
      "Up to 5 active cases",
      "Reminder generator",
      "Basic evidence upload",
      "Payment tracking",
      "Email support",
    ],
    cta:      "Start Free",
    href:     "/signup",
    primary:  false,
  },
  {
    name:     "Starter",
    price:    "RM 49",
    period:   "/ month",
    desc:     "For SMEs actively chasing debtors.",
    color:    "border-[#009966]",
    badge:    "Most Popular",
    features: [
      "Up to 50 active cases",
      "Professional reminders (all tones)",
      "Payment Lock & proof review",
      "Evidence pack PDF export",
      "Formal demand letter draft",
      "Priority support",
    ],
    cta:      "Start Starter",
    href:     "/signup",
    primary:  true,
  },
  {
    name:     "Boss",
    price:    "RM 149",
    period:   "/ month",
    desc:     "For high-volume collections & teams.",
    color:    "border-[#0D1B3D]",
    badge:    null,
    features: [
      "Unlimited active cases",
      "Everything in Starter",
      "Team members (up to 5)",
      "Lawyer referral directory",
      "Small claim pack generator",
      "Custom branding on documents",
      "Dedicated account manager",
    ],
    cta:      "Go Boss",
    href:     "/signup",
    primary:  false,
  },
];

function Pricing() {
  return (
    <section id="pricing" className="py-20 px-5 bg-[#F2F4F7]">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <p className="text-xs font-bold text-[#009966] uppercase tracking-widest mb-3">Pricing</p>
          <h2 className="text-3xl md:text-4xl font-black text-[#0D1B3D]">Simple, honest pricing.</h2>
          <p className="text-gray-500 mt-3 max-w-lg mx-auto text-base">
            Start free. Upgrade when you need more.
            All prices in Ringgit Malaysia.
          </p>
          <div className="inline-flex items-center gap-2 mt-4 bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold px-4 py-2 rounded-full">
            <Clock className="w-3.5 h-3.5 text-amber-500" />
            Pricing coming soon — all features free during beta
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={cn(
                "relative bg-white rounded-2xl border-2 p-6 flex flex-col shadow-sm",
                plan.color,
                plan.primary && "shadow-lg shadow-emerald-100/50 scale-[1.02]",
              )}
            >
              {plan.badge && (
                <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-[#009966] text-white text-[10px] font-black px-3 py-1 rounded-full whitespace-nowrap">
                  {plan.badge}
                </span>
              )}

              <div className="mb-5">
                <p className="text-sm font-black text-[#0D1B3D] mb-1">{plan.name}</p>
                <div className="flex items-end gap-1 mb-1.5">
                  <span className="text-3xl font-black text-[#0D1B3D]">{plan.price}</span>
                  <span className="text-sm text-gray-400 mb-1 font-medium">{plan.period}</span>
                </div>
                <p className="text-xs text-gray-500">{plan.desc}</p>
              </div>

              <ul className="flex flex-col gap-2.5 flex-1 mb-6">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#009966] shrink-0 mt-0.5" />
                    <span className="text-xs text-gray-700">{f}</span>
                  </li>
                ))}
              </ul>

              <Link
                href={plan.href}
                className={cn(
                  "flex items-center justify-center gap-1.5 text-sm font-bold py-3 rounded-xl transition-colors",
                  plan.primary
                    ? "bg-[#009966] hover:bg-[#00B377] text-white"
                    : "bg-gray-100 hover:bg-gray-200 text-[#0D1B3D]",
                )}
              >
                {plan.cta} <ChevronRight className="w-4 h-4" />
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── FAQ ──────────────────────────────────────────────────────────────────────

const faqs = [
  {
    q: "Is CollectBoss a debt collection agency?",
    a: "No. CollectBoss is a software tool that helps you manage your own debt recovery process. We do not contact your debtors on your behalf — you remain in full control of all communications.",
  },
  {
    q: "Is my data secure?",
    a: "Yes. All data is stored securely with row-level security — only your business can see your cases. We do not share your data with third parties, and payment account details are never exposed without your explicit approval.",
  },
  {
    q: "Can I use CollectBoss for B2C debts?",
    a: "Yes, but please ensure you comply with Malaysian consumer protection laws. CollectBoss is designed primarily for B2B (business-to-business) debt recovery, such as unpaid invoices between companies.",
  },
  {
    q: "Does CollectBoss support Bahasa Malaysia?",
    a: "Yes. Our reminder generator creates messages in both Bahasa Malaysia and English, so you can communicate professionally in whichever language your debtor prefers.",
  },
  {
    q: "Can the evidence pack be used in court?",
    a: "The evidence pack PDF is designed to organise and present your documentation clearly. While it is not a legal document itself, it contains all the evidence you need to support a claim at the Tribunal Tuntutan Pengguna Malaysia or through a lawyer.",
  },
  {
    q: "What happens to my data if I cancel?",
    a: "You can export all your case records and documents before cancelling. We retain data for 30 days after cancellation, then it is permanently deleted.",
  },
];

function FAQ() {
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  return (
    <section id="faq" className="py-20 px-5 bg-white">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-12">
          <p className="text-xs font-bold text-[#009966] uppercase tracking-widest mb-3">FAQ</p>
          <h2 className="text-3xl md:text-4xl font-black text-[#0D1B3D]">Common questions.</h2>
        </div>

        <div className="flex flex-col gap-2">
          {faqs.map((faq, i) => {
            const isOpen = openIdx === i;
            return (
              <div
                key={faq.q}
                className={cn(
                  "rounded-xl border transition-all overflow-hidden",
                  isOpen ? "border-emerald-200 bg-emerald-50/40" : "border-gray-100 bg-white",
                )}
              >
                <button
                  onClick={() => setOpenIdx(isOpen ? null : i)}
                  className="w-full flex items-center justify-between px-5 py-4 text-left gap-3"
                >
                  <p className={cn("text-sm font-semibold", isOpen ? "text-[#009966]" : "text-[#0D1B3D]")}>
                    {faq.q}
                  </p>
                  <ChevronDown
                    className={cn(
                      "w-4 h-4 shrink-0 transition-transform text-gray-400",
                      isOpen && "rotate-180 text-[#009966]",
                    )}
                  />
                </button>
                {isOpen && (
                  <div className="px-5 pb-4">
                    <p className="text-sm text-gray-600 leading-relaxed">{faq.a}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ─── CTA Banner ───────────────────────────────────────────────────────────────

function CTABanner() {
  return (
    <section className="py-20 px-5 bg-[#0D1B3D]">
      <div className="max-w-2xl mx-auto text-center">
        <TrendingUp className="w-10 h-10 text-[#009966] mx-auto mb-4" />
        <h2 className="text-3xl md:text-4xl font-black text-white leading-tight mb-4">
          Stop chasing. Start collecting.
        </h2>
        <p className="text-blue-200 text-base mb-8 leading-relaxed">
          Join Malaysian SME owners who use CollectBoss to recover money
          they were owed — professionally and without awkward conversations.
        </p>
        <Link
          href="/signup"
          className="inline-flex items-center gap-2 bg-[#009966] hover:bg-[#00B377] text-white font-bold text-base px-8 py-4 rounded-2xl transition-all shadow-lg shadow-emerald-900/40 hover:shadow-emerald-900/60"
        >
          Start Free Today <ArrowRight className="w-4 h-4" />
        </Link>
        <p className="mt-4 text-blue-300 text-xs">
          No credit card required · Cancel anytime
        </p>
      </div>
    </section>
  );
}

// ─── Footer ───────────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer className="bg-[#0D1B3D] border-t border-white/10 px-5 py-12">
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-col md:flex-row items-start justify-between gap-8 mb-10">
          {/* Brand */}
          <div className="max-w-xs">
            <span className="text-2xl font-black tracking-tight text-white">
              Collect<span className="text-[#009966]">Boss</span>
            </span>
            <p className="text-blue-300 text-xs mt-2 leading-relaxed">
              Collect Smart. Recover Better.
            </p>
            <p className="text-blue-400 text-[11px] mt-3 leading-relaxed">
              Built in Malaysia 🇲🇾 for Malaysian SMEs.
            </p>
          </div>

          {/* Links */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-8 text-sm">
            <div>
              <p className="text-blue-200 font-bold text-xs uppercase tracking-wide mb-3">Product</p>
              <ul className="flex flex-col gap-2">
                {["Features", "How It Works", "Pricing", "FAQ"].map((l) => (
                  <li key={l}>
                    <a href={`#${l.toLowerCase().replace(/ /g, "")}`} className="text-blue-400 hover:text-blue-200 text-xs transition-colors">
                      {l}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-blue-200 font-bold text-xs uppercase tracking-wide mb-3">Company</p>
              <ul className="flex flex-col gap-2">
                {[
                  { label: "Sign Up",  href: "/signup" },
                  { label: "Sign In",  href: "/login"  },
                ].map((l) => (
                  <li key={l.label}>
                    <Link href={l.href} className="text-blue-400 hover:text-blue-200 text-xs transition-colors">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-blue-200 font-bold text-xs uppercase tracking-wide mb-3">Legal</p>
              <ul className="flex flex-col gap-2">
                {[
                  { label: "Privacy Policy",    href: "/privacy"          },
                  { label: "Terms of Use",       href: "/terms"            },
                  { label: "Legal Disclaimer",   href: "/legal-disclaimer" },
                  { label: "PDPA Consent",       href: "/pdpa-consent"     },
                  { label: "Support",            href: "/support"          },
                ].map((l) => (
                  <li key={l.label}>
                    <Link href={l.href} className="text-blue-400 hover:text-blue-200 text-xs transition-colors">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* Legal disclaimer */}
        <div className="border-t border-white/10 pt-8">
          <div className="bg-white/5 rounded-xl px-5 py-4 mb-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-amber-300 text-[11px] font-bold mb-1 uppercase tracking-wide">Legal Disclaimer</p>
                <p className="text-blue-300 text-[11px] leading-relaxed">
                  CollectBoss is a debt management software tool, not a law firm and not a debt collection agency.
                  CollectBoss does not provide legal advice. All communications, documents, and actions
                  taken using this platform are your responsibility as the creditor.
                  Formal demand letters and evidence packs generated by CollectBoss are drafts only — consult
                  a qualified Malaysian solicitor before taking legal action.
                  Use of this platform must comply with the Consumer Protection Act 1999,
                  the Contracts Act 1950, and all applicable Malaysian laws.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-blue-400 text-[11px]">
              © {new Date().getFullYear()} CollectBoss. All rights reserved.
            </p>
            <p className="text-blue-500 text-[10px]">
              CollectBoss is not affiliated with Bank Negara Malaysia or any financial regulator.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function LandingPage() {
  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <main id="landing-main-content">
        <Hero />
        <PainPoints />
        <Features />
        <HowItWorks />
        <Pricing />
        <FAQ />
        <CTABanner />
      </main>
      <Footer />
    </div>
  );
}
