"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ProductQuiz } from "@/components/onboarding/product-quiz";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { CollectBossWordmark } from "@/components/brand/wordmark";
import { PLAN_MARKETING, PLAN_ORDER, PLANS, planFeatureLabels } from "@/lib/billing/plans";
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
  Menu,
  X,
  ArrowRight,
  TrendingUp,
  Lock,
  Building2,
  Smartphone,
} from "lucide-react";

// ─── Navbar ───────────────────────────────────────────────────────────────────

function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);

  const links = [
    { href: "#features",   label: "Features"   },
    { href: "#how",        label: "How It Works"},
    { href: "#products",   label: "Choose Product"},
    { href: "#pricing",    label: "Pricing"     },
    { href: "#faq",        label: "FAQ"         },
  ];

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--cb-border)] bg-white/95 backdrop-blur-sm">
      <a
        href="#landing-main-content"
        className="sr-only fixed left-3 top-3 z-[100] rounded-md bg-white px-3 py-2 text-sm font-semibold text-[#0D1B3D] shadow focus:not-sr-only"
      >
        Skip to main content
      </a>
      <div className="max-w-7xl mx-auto px-5 lg:px-8 h-20 flex items-center justify-between gap-5">
        {/* Logo */}
        <Link href="/landing" aria-label="CollectBoss home">
          <CollectBossWordmark compact />
        </Link>

        {/* Desktop nav */}
        <nav className="cb-phone-landscape-desktop hidden lg:flex items-center gap-6">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="inline-flex min-h-11 items-center text-sm font-medium text-slate-600 hover:text-slate-950 transition-colors"
            >
              {l.label}
            </a>
          ))}
        </nav>

        {/* Desktop CTA */}
        <div className="cb-phone-landscape-desktop hidden lg:flex items-center gap-3">
          <Link href="/login" className="inline-flex min-h-11 items-center text-sm font-medium text-slate-700 hover:text-slate-950 transition-colors">
            Sign In
          </Link>
          <Link
            href="/signup"
            className="cb-button-primary"
          >
            Start Free <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {/* Mobile hamburger */}
        <button
          className="cb-phone-landscape-mobile lg:hidden w-11 h-11 flex items-center justify-center rounded-lg hover:bg-slate-100 transition-colors"
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="Toggle menu"
          aria-controls="landing-mobile-nav"
          aria-expanded={menuOpen}
        >
          {menuOpen ? <X className="w-5 h-5 text-slate-800" /> : <Menu className="w-5 h-5 text-slate-800" />}
        </button>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="cb-phone-landscape-mobile-block lg:hidden border-t border-gray-100 bg-white px-5 pb-4">
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
    <section className="border-b border-[var(--cb-border)] bg-[var(--cb-background)] px-5 py-14 sm:py-20 lg:px-8 lg:py-24">
      <div className="mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
        <div>
          <p className="mb-6 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--cb-action-primary)]">A clearer view of business receivables</p>
          <h1 className="max-w-2xl text-4xl font-medium leading-[1.1] tracking-tight text-[var(--cb-brand-navy)] sm:text-5xl xl:text-6xl">Collect overdue payments.<br /><span className="text-[var(--cb-action-primary)]">With confidence.</span></h1>
          <p className="mt-7 max-w-xl text-base leading-7 text-slate-600 sm:text-lg">Bring debts, follow-ups and payment records into one organised workspace. Built for Malaysian businesses that want a more professional way to collect.</p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link href="/signup" className="cb-button-primary min-h-12 px-6">Start with CollectBoss <ArrowRight aria-hidden="true" className="size-4" /></Link>
            <a href="#products" className="cb-button-secondary min-h-12 px-6">Compare Main & Pocket</a>
          </div>
          <p className="mt-5 text-sm text-slate-500">Free plan available · No credit card required</p>
        </div>
        <div className="overflow-hidden rounded-xl border border-[var(--cb-border)] bg-white shadow-[0_16px_48px_rgb(13_27_61_/_0.08)]">
          <div className="flex items-center justify-between gap-4 border-b border-white/10 bg-[var(--cb-brand-navy)] px-6 py-5 text-white"><span className="text-sm font-medium">A structured collection workflow</span><ClipboardList aria-hidden="true" className="size-5 text-emerald-300" /></div>
          <ol className="divide-y divide-[var(--cb-divider)] px-6">
            {[
              { icon: FolderOpen, title: "Keep the facts together", detail: "Customers, invoices and supporting documents." },
              { icon: Send, title: "Know the next action", detail: "Follow-ups, promises and payment due dates." },
              { icon: CheckCircle2, title: "Keep payments accountable", detail: "Payment proof, review and recorded balances." },
            ].map(({ icon: Icon, title, detail }, index) => <li key={title} className="flex gap-4 py-6"><span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-[var(--cb-surface-muted)] text-[var(--cb-brand-navy)]"><Icon aria-hidden="true" className="size-5" /></span><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-slate-900">{title}</p><p className="mt-1 text-sm leading-6 text-slate-500">{detail}</p></div><span aria-hidden="true" className="pt-1 font-mono text-xs text-slate-400">0{index + 1}</span></li>)}
          </ol>
          <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-[var(--cb-divider)] bg-slate-50 px-6 py-4 text-xs text-slate-600"><span>Main · Structured collections</span><span>Pocket · Everyday tracking</span></div>
        </div>
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
          <p className="text-xs font-semibold text-[#009966] uppercase tracking-widest mb-3">Designed around your daily work</p>
          <h2 className="text-3xl md:text-4xl font-semibold text-[#0D1B3D] leading-tight">
            Less administration. More clarity.
          </h2>
          <p className="text-gray-500 mt-3 max-w-xl mx-auto text-base">
            Give every outstanding payment a clear record, a responsible owner and a next step.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {painPoints.map((p, index) => (
            <div
              key={p.title}
              className="cb-surface flex gap-4 p-6"
            >
              <span aria-hidden="true" className="mt-0.5 shrink-0 font-mono text-sm text-[var(--cb-action-primary)]">0{index + 1}</span>
              <div>
                <p className="text-sm font-bold text-gray-900 mb-1">{p.title}</p>
                <p className="text-sm text-gray-500 leading-relaxed">{p.body}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Bridge */}
        <div className="mt-10 flex items-center justify-center gap-3 text-center">
          <div className="h-px flex-1 bg-[var(--cb-divider)]" />
          <p className="text-sm font-medium text-[#0D1B3D]">One organised collection workflow.</p>
          <div className="h-px flex-1 bg-[var(--cb-divider)]" />
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
    tag:    "Guided follow-up",
  },
  {
    icon:   <Lock          className="w-6 h-6" />,
    accent: "text-purple-600 bg-purple-50",
    title:  "Payment Lock",
    body:   "Control access to receiving-account details through the supported payment-access workflow. Review requests and keep an access record.",
    tag:    "Security",
  },
  {
    icon:   <ClipboardList className="w-6 h-6" />,
    accent: "text-amber-600 bg-amber-50",
    title:  "Case Evidence Export",
    body:   "Upload invoices, delivery orders, contracts, and photos, then export an organised factual PDF for your records or external review.",
    tag:    "Record keeping",
  },
  {
    icon:   <FileText      className="w-6 h-6" />,
    accent: "text-orange-600 bg-orange-50",
    title:  "Formal Payment Reminder",
    body:   "Prepare a creditor-authored payment reminder or final payment notice from recorded case facts, with a visible legal disclaimer.",
    tag:    "Notice draft",
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
    body: "Prepare a payment-notice draft or factual Case Evidence Export, then request qualified external review when needed.",
  },
];

function HowItWorks() {
  const [activeStep, setActiveStep] = useState(0);
  const selected = steps[activeStep];
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
          <div className="hidden md:block absolute top-6 left-[calc(10%+20px)] right-[calc(10%+20px)] h-0.5 bg-[var(--cb-divider)]" />

          {steps.map((s, i) => (
            <div key={s.n} className="flex-1 flex flex-col items-center text-center px-3">
              {/* Mobile: connecting line */}
              {i > 0 && (
                <div className="md:hidden w-0.5 h-8 bg-[var(--cb-divider)] mb-0" />
              )}

              {/* Circle */}
              <button
                type="button"
                onClick={() => setActiveStep(i)}
                aria-pressed={activeStep === i}
                aria-controls="tour-step-detail"
                className={cn(
                  "relative z-10 mb-4 flex h-12 w-12 shrink-0 items-center justify-center rounded-full shadow-md transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007A52] focus-visible:ring-offset-2",
                  activeStep === i ? "scale-110 bg-[#009966] shadow-emerald-200" : "bg-[#0D1B3D] shadow-slate-200 hover:scale-105",
                )}
              >
                {s.icon}
                <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-[#0D1B3D] text-white text-[9px] font-black flex items-center justify-center border-2 border-white">
                  {s.n}
                </span>
              </button>

              <p className="text-sm font-black text-[#0D1B3D] mb-1.5">{s.title}</p>
              <p className="text-xs text-gray-500 leading-relaxed max-w-[160px] mx-auto">{s.body}</p>
            </div>
          ))}
        </div>

        <div id="tour-step-detail" aria-live="polite" className="mx-auto mt-10 max-w-xl rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-[#007A52]">Tour step {selected.n} of {steps.length}</p>
          <h3 className="mt-2 text-lg font-black text-[#0D1B3D]">{selected.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-gray-600">{selected.body}</p>
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

// ─── Product fit ──────────────────────────────────────────────────────────────

function ProductFit() {
  const router = useRouter();
  const products = [
    {
      name: "CollectBoss",
      icon: Building2,
      bestFor: "Businesses managing structured collection cases, controls, teams, evidence and reporting.",
      points: ["Full case-to-payment workflow", "Team permissions and operational controls", "Evidence exports and advanced reporting"],
      href: "/signup?plan=free",
      cta: "Choose CollectBoss",
    },
    {
      name: "CollectBoss Pocket",
      icon: Smartphone,
      bestFor: "Solo operators who want a simpler, mobile-first way to track debts, receipts and reminders.",
      points: ["Fast mobile-first daily workflow", "Customers, debts, receipts and reminders", "Upgrade path to the full workspace"],
      href: "/signup?product=pocket",
      cta: "Choose Pocket",
    },
  ] as const;

  return (
    <section id="products" className="bg-white px-5 py-20">
      <div className="mx-auto max-w-5xl">
        <div className="mb-10 text-center">
          <p className="mb-3 text-xs font-bold uppercase tracking-widest text-[#009966]">Choose the right product</p>
          <h2 className="text-3xl font-black text-[#0D1B3D] md:text-4xl">CollectBoss or CollectBoss Pocket?</h2>
          <p className="mx-auto mt-3 max-w-2xl text-base text-gray-500">Both use one secure account. Choose based on how much workflow depth your business needs today.</p>
        </div>
        <div className="mx-auto mb-8 flex max-w-2xl justify-center">
          <div className="w-full text-center [&>section]:text-left">
            <ProductQuiz
              chooseLabel="Start with this product"
              onChoose={(product) => router.push(product === "pocket" ? "/signup?product=pocket" : "/signup?plan=free")}
            />
          </div>
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          {products.map(({ name, icon: Icon, bestFor, points, href, cta }) => (
            <article key={name} className="flex flex-col rounded-2xl border-2 border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#0D1B3D] text-white"><Icon aria-hidden="true" className="h-5 w-5" /></span>
                <h3 className="text-xl font-black text-[#0D1B3D]">{name}</h3>
              </div>
              <p className="mt-4 text-sm leading-relaxed text-gray-600">{bestFor}</p>
              <ul className="my-5 flex flex-1 flex-col gap-2">
                {points.map((point) => <li key={point} className="flex gap-2 text-sm text-gray-700"><CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[#009966]" />{point}</li>)}
              </ul>
              <Link href={href} className="flex min-h-11 items-center justify-center rounded-xl bg-[#009966] px-4 py-3 text-sm font-bold text-white hover:bg-[#00B377]">{cta}</Link>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Pricing ──────────────────────────────────────────────────────────────────

const plans = PLAN_ORDER.map((slug) => {
  const plan = PLANS[slug];
  const marketing = PLAN_MARKETING[slug];
  return {
    name: plan.name,
    slug,
    price: plan.monthly_price_rm === 0 ? "RM 0" : `RM ${plan.monthly_price_rm}`,
    period: plan.monthly_price_rm === 0 ? "forever" : "/ month",
    desc: marketing.description,
    color: marketing.color,
    badge: marketing.badge,
    features: planFeatureLabels(plan),
    cta: marketing.cta,
    href: `/signup?plan=${slug}`,
    primary: marketing.primary,
  };
});

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
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
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
    a: "The Case Evidence Export organises the records you selected. It is not a filed claim, does not prove admissibility or completeness, and does not determine court or tribunal eligibility. Verify requirements with the relevant official authority and a qualified legal professional.",
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
                  type="button"
                  onClick={() => setOpenIdx(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  aria-controls={`landing-faq-answer-${i}`}
                  id={`landing-faq-question-${i}`}
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
                  <div id={`landing-faq-answer-${i}`} role="region" aria-labelledby={`landing-faq-question-${i}`} className="px-5 pb-4">
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
          Create your secure account, choose the right product, and start a guided recovery workflow.
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
            <CollectBossWordmark variant="dark" className="text-2xl" />
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
                {[
                  { label: "Features", href: "#features" },
                  { label: "How It Works", href: "#how" },
                  { label: "Choose Product", href: "#products" },
                  { label: "Pricing", href: "#pricing" },
                  { label: "FAQ", href: "#faq" },
                ].map((item) => (
                  <li key={item.href}>
                    <a href={item.href} className="text-blue-400 hover:text-blue-200 text-xs transition-colors">
                      {item.label}
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
                  { label: "System Status", href: "/status" },
                  { label: "Beginner Glossary", href: "/glossary" },
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
                  Payment notices and case evidence exports generated by CollectBoss are factual drafts only;
                  they are not issued with lawyer or court authority. Consult a qualified Malaysian solicitor before legal action.
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
        <ProductFit />
        <Pricing />
        <FAQ />
        <CTABanner />
      </main>
      <Footer />
    </div>
  );
}
