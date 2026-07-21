"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Clock, RefreshCw } from "lucide-react";
import { useSubscription } from "@/hooks/use-subscription";

const PAID_STATUSES = new Set(["active", "trialing"]);

/**
 * Checkout returns here before Stripe's webhook may have updated Supabase.
 * This view reads the owner's subscription row and never treats the Checkout
 * redirect or its query string as payment confirmation.
 */
export function BillingSuccessStatus() {
  const { subscription, loading, error, refresh } = useSubscription();
  const [polling, setPolling] = useState(true);
  const isVerifiedPaid = Boolean(
    subscription &&
      subscription.plan_slug !== "free" &&
      PAID_STATUSES.has(subscription.status),
  );

  useEffect(() => {
    if (isVerifiedPaid) return;

    const interval = window.setInterval(refresh, 3_000);
    const timeout = window.setTimeout(() => setPolling(false), 45_000);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [isVerifiedPaid, refresh]);

  const isPolling = polling && !isVerifiedPaid;

  const title = isVerifiedPaid
    ? "Subscription active"
    : isPolling
      ? "Confirming your payment"
      : "Payment confirmation is still pending";
  const message = isVerifiedPaid
    ? `Your ${subscription?.plan_slug} plan is active. This status was verified from your account.`
    : error
      ? "We could not retrieve your subscription status. Please try again from the billing page."
      : "Stripe will activate your plan after its signed webhook is processed. This page does not treat the redirect itself as payment confirmation.";

  return (
    <div className="min-h-screen bg-[#F2F4F7] flex flex-col items-center justify-center px-5 text-center">
      <Link href="/" className="text-2xl font-black tracking-tight text-[#0D1B3D] mb-10">
        Collect<span className="text-[#009966]">Boss</span>
      </Link>

      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 px-8 py-10 max-w-sm w-full">
        <div className="w-16 h-16 bg-emerald-50 rounded-2xl flex items-center justify-center mx-auto mb-5">
          {isVerifiedPaid ? (
            <CheckCircle2 className="w-8 h-8 text-[#009966]" />
          ) : (
            <Clock className="w-8 h-8 text-blue-500" />
          )}
        </div>
        <h1 className="text-lg font-black text-[#0D1B3D] mb-2">{title}</h1>
        <p className="text-sm text-gray-600 leading-relaxed mb-6">{message}</p>

        {!isVerifiedPaid && (
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="flex items-center justify-center gap-2 w-full border border-emerald-200 text-[#009966] font-bold text-sm py-3 rounded-2xl hover:bg-emerald-50 transition-colors mb-3 disabled:opacity-60"
          >
            <RefreshCw className={loading ? "w-4 h-4 animate-spin" : "w-4 h-4"} />
            Check status again
          </button>
        )}
        <Link
          href={isVerifiedPaid ? "/" : "/billing"}
          className="flex items-center justify-center gap-2 w-full bg-[#009966] hover:bg-[#00B377] text-white font-bold text-sm py-3 rounded-2xl transition-colors"
        >
          {isVerifiedPaid ? "Go to Dashboard" : "View billing page"}
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}
