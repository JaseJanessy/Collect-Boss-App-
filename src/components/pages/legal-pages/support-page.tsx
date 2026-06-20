"use client";

import { useState } from "react";
import {
  LegalShell, LegalH2, LegalH3, LegalP, LegalUL, LegalHighlight,
} from "./legal-shell";
import {
  Mail, MessageSquare, Bug, Clock, Shield, FileText,
} from "lucide-react";

// ─── Contact category cards ───────────────────────────────────────────────────

interface ContactCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  action: string;
  href: string;
}

function ContactCard({ icon, title, description, action, href }: ContactCardProps) {
  return (
    <a
      href={href}
      className="flex items-start gap-4 p-4 rounded-2xl border border-gray-100 hover:border-[#009966]/30 hover:bg-[#009966]/5 transition-all group"
    >
      <div className="w-10 h-10 rounded-xl bg-[#0D1B3D]/5 flex items-center justify-center shrink-0 group-hover:bg-[#009966]/10 transition-colors">
        <span className="text-[#0D1B3D] group-hover:text-[#009966] transition-colors">
          {icon}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-black text-[#0D1B3D] mb-0.5">{title}</p>
        <p className="text-xs text-gray-500 leading-relaxed mb-2">{description}</p>
        <span className="text-xs font-bold text-[#009966]">{action} →</span>
      </div>
    </a>
  );
}

// ─── FAQ accordion ────────────────────────────────────────────────────────────

const faqs: { q: string; a: string }[] = [
  {
    q: "How do I upgrade or downgrade my plan?",
    a: "Go to Billing in the sidebar (or More → Billing & Plan on mobile). Click 'Manage Subscription' to open the Stripe Billing Portal where you can change your plan, update payment details, or cancel.",
  },
  {
    q: "My payment failed — what happens to my account?",
    a: "If a payment fails, Stripe will retry automatically over several days. Your account stays active during this grace period. If the payment is not resolved, your plan will be downgraded to Free. You can update your payment method in the Stripe Billing Portal via Billing → Manage Subscription.",
  },
  {
    q: "Can I get a refund?",
    a: "CollectBoss subscriptions are billed monthly with no refunds for partial periods, unless required by Malaysian consumer law. If you cancel, your paid plan remains active until the end of the current billing period.",
  },
  {
    q: "How do I delete my account?",
    a: "To delete your account and all associated data, contact us via the support email below. We will process your request within 21 days in accordance with the PDPA 2010.",
  },
  {
    q: "Is my debtor data secure?",
    a: "Yes. All data is encrypted in transit via TLS. Database access is protected by Row-Level Security — each user can only read their own records. Evidence files and payment proofs are stored in private, access-controlled storage. We never sell your data.",
  },
  {
    q: "The platform is not recognising my Stripe payment — my subscription still shows Free.",
    a: "Stripe webhook events can take up to 60 seconds to process after checkout. If your plan has not updated after 2 minutes, try refreshing the Billing page. If the issue persists, contact support with your registered email address and we will check the subscription status manually.",
  },
  {
    q: "Can I export all my data?",
    a: "You can export individual Evidence Packs as PDFs from each case. Full account data export is available upon written request via support — we will provide a structured export within 21 days.",
  },
  {
    q: "What Malaysian courts can I use to recover a debt?",
    a: "CollectBoss is a software tool and does not provide legal advice. In general, Malaysian SMEs may file small claims (up to RM5,000) at the Consumer Claims Tribunal (Tribunal Tuntutan Pengguna Malaysia), or at the Magistrates Court for higher amounts. For complex or large debts, consult a qualified Malaysian solicitor.",
  },
];

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-gray-100 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors"
      >
        <span className="text-sm font-semibold text-[#0D1B3D] pr-4">{q}</span>
        <span className={`text-lg font-bold text-[#009966] shrink-0 transition-transform ${open ? "rotate-45" : ""}`}>+</span>
      </button>
      {open && (
        <div className="px-4 pb-4 border-t border-gray-100">
          <p className="text-sm text-gray-600 leading-relaxed pt-3">{a}</p>
        </div>
      )}
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export function SupportPage() {
  return (
    <LegalShell
      title="Contact & Support"
      subtitle="Get help with CollectBoss — billing, account, data, or platform questions."
      lastUpdated="2025-01-01"
    >
      <LegalH2>How to Reach Us</LegalH2>

      <div className="grid sm:grid-cols-2 gap-3 mb-8">
        <ContactCard
          icon={<Mail className="w-5 h-5" />}
          title="General Support"
          description="Account, billing, platform usage, and general questions."
          action="Email support"
          href="mailto:support@collectboss.my"
        />
        <ContactCard
          icon={<Bug className="w-5 h-5" />}
          title="Report a Bug"
          description="Found a technical issue? Tell us what happened and what you expected."
          action="Email bug report"
          href="mailto:bugs@collectboss.my"
        />
        <ContactCard
          icon={<Shield className="w-5 h-5" />}
          title="Privacy & PDPA Requests"
          description="Data access, correction, deletion, or consent withdrawal requests."
          action="Email privacy team"
          href="mailto:privacy@collectboss.my"
        />
        <ContactCard
          icon={<FileText className="w-5 h-5" />}
          title="Legal & Compliance"
          description="Legal notices, court orders, or compliance-related correspondence."
          action="Email legal team"
          href="mailto:legal@collectboss.my"
        />
      </div>

      <LegalHighlight>
        CollectBoss is a private beta product. Response times may vary. We aim to respond
        to all queries within 2 business days (Kuala Lumpur time, UTC+8), Monday to Friday.
        For urgent account issues, email support@collectboss.my with &ldquo;URGENT&rdquo; in the subject line.
      </LegalHighlight>

      <LegalH2>Response Times</LegalH2>
      <div className="grid sm:grid-cols-3 gap-3 mb-6">
        {[
          { label: "General support",     time: "2 business days",  icon: <MessageSquare className="w-4 h-4" /> },
          { label: "Billing issues",      time: "1 business day",   icon: <Clock className="w-4 h-4" /> },
          { label: "PDPA / Privacy",      time: "21 days (PDPA)",   icon: <Shield className="w-4 h-4" /> },
        ].map(({ label, time, icon }) => (
          <div key={label} className="flex flex-col gap-2 p-4 rounded-2xl bg-[#F2F4F7]">
            <div className="flex items-center gap-2 text-[#0D1B3D]">{icon}<span className="text-xs font-bold">{label}</span></div>
            <p className="text-sm font-black text-[#009966]">{time}</p>
          </div>
        ))}
      </div>

      <LegalH2>In-App Feedback</LegalH2>
      <LegalP>
        You can also use the feedback button in the bottom-right corner of the app (the chat
        bubble icon) to send feedback or report bugs directly from within CollectBoss.
        Feedback submitted this way is stored locally and reviewed by our team.
      </LegalP>

      <LegalH2>Frequently Asked Questions</LegalH2>

      <div className="flex flex-col gap-2 mb-6">
        {faqs.map((item) => (
          <FaqItem key={item.q} q={item.q} a={item.a} />
        ))}
      </div>

      <LegalH2>Platform Status</LegalH2>
      <LegalP>
        CollectBoss is currently in private beta. During the beta period, planned maintenance
        may occur without advance notice. We do not currently publish a public status page.
        For urgent outage queries, email support@collectboss.my.
      </LegalP>

      <LegalH2>Business Details</LegalH2>
      <LegalH3>CollectBoss</LegalH3>
      <LegalUL>
        <li>Platform type: Software-as-a-Service (SaaS) — Malaysia</li>
        <li>Support email: support@collectboss.my</li>
        <li>Operating hours: Monday–Friday, 9am–6pm MYT (UTC+8)</li>
        <li>Language: English and Bahasa Malaysia</li>
      </LegalUL>
      <LegalP>
        CollectBoss is a software company and is not a law firm. We do not provide legal
        advice or legal services. For legal matters relating to debt recovery, consult a
        qualified solicitor admitted to the Malaysian Bar.
      </LegalP>
    </LegalShell>
  );
}
