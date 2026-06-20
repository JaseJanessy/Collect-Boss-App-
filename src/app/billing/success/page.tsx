import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, ArrowRight, Clock } from "lucide-react";

export const metadata: Metadata = {
  title: "Payment Received",
  robots: { index: false },
};

export default function BillingSuccessPage() {
  return (
    <div className="min-h-screen bg-[#F2F4F7] flex flex-col items-center justify-center px-5 text-center">
      {/* Wordmark */}
      <Link href="/" className="text-2xl font-black tracking-tight text-[#0D1B3D] mb-10">
        Collect<span className="text-[#009966]">Boss</span>
      </Link>

      {/* Card */}
      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 px-8 py-10 max-w-sm w-full">
        {/* Icon */}
        <div className="w-16 h-16 bg-emerald-50 rounded-2xl flex items-center justify-center mx-auto mb-5">
          <CheckCircle2 className="w-8 h-8 text-[#009966]" />
        </div>

        {/* Headline */}
        <h1 className="text-lg font-black text-[#0D1B3D] mb-2">
          Payment received!
        </h1>

        {/* Body */}
        <p className="text-sm text-gray-600 leading-relaxed mb-5">
          Your subscription is being activated. This may take a few seconds
          while we receive confirmation from Stripe.
        </p>

        {/* Activation note */}
        <div className="flex items-start gap-3 bg-blue-50 border border-blue-100 rounded-xl p-3 mb-6 text-left">
          <Clock className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
          <p className="text-[11px] text-blue-700 leading-relaxed">
            If your plan does not update immediately, wait a moment and refresh
            the page. Activation is automatic once Stripe confirms payment.
          </p>
        </div>

        {/* CTA */}
        <Link
          href="/"
          className="flex items-center justify-center gap-2 w-full bg-[#009966] hover:bg-[#00B377] text-white font-bold text-sm py-3 rounded-2xl transition-colors"
        >
          Go to Dashboard
          <ArrowRight className="w-4 h-4" />
        </Link>

        <Link
          href="/billing"
          className="block mt-3 text-xs font-medium text-gray-400 hover:text-gray-600 transition-colors"
        >
          View billing page →
        </Link>
      </div>

      {/* Legal */}
      <p className="mt-8 text-[11px] text-gray-400 max-w-xs">
        A receipt has been sent to your email by Stripe.
        Manage your subscription at any time from the billing page.
      </p>
    </div>
  );
}
