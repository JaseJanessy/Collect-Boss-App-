import type { Metadata } from "next";
import Link from "next/link";
import { XCircle, ArrowLeft, CreditCard } from "lucide-react";

export const metadata: Metadata = {
  title: "Checkout Cancelled",
  robots: { index: false },
};

export default function BillingCancelPage() {
  return (
    <div className="min-h-screen bg-[#F2F4F7] flex flex-col items-center justify-center px-5 text-center">
      {/* Wordmark */}
      <Link href="/" className="text-2xl font-black tracking-tight text-[#0D1B3D] mb-10">
        Collect<span className="text-[#009966]">Boss</span>
      </Link>

      {/* Card */}
      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 px-8 py-10 max-w-sm w-full">
        {/* Icon */}
        <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-5">
          <XCircle className="w-8 h-8 text-gray-400" />
        </div>

        {/* Headline */}
        <h1 className="text-lg font-black text-[#0D1B3D] mb-2">
          Checkout cancelled
        </h1>

        {/* Body */}
        <p className="text-sm text-gray-500 leading-relaxed mb-7">
          No payment was made. Your current plan is unchanged.
          You can return to billing and try again whenever you are ready.
        </p>

        {/* CTAs */}
        <Link
          href="/billing"
          className="flex items-center justify-center gap-2 w-full bg-[#009966] hover:bg-[#00B377] text-white font-bold text-sm py-3 rounded-2xl transition-colors mb-3"
        >
          <CreditCard className="w-4 h-4" />
          Back to Billing
        </Link>

        <Link
          href="/"
          className="flex items-center justify-center gap-2 w-full text-sm font-semibold text-gray-500 hover:text-gray-700 py-2 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Go to Dashboard
        </Link>
      </div>
    </div>
  );
}
