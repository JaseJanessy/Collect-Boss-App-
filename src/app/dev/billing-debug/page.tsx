/**
 * /dev/billing-debug
 *
 * Development-only billing debug page.
 * Blocked in production via NEXT_PUBLIC_APP_ENV check.
 * Auth is still required (handled by proxy.ts middleware).
 */

import type { Metadata } from "next";
import { BillingDebugPage } from "@/components/pages/dev/billing-debug-page";

export const metadata: Metadata = {
  title:  "Billing Debug",
  robots: { index: false, follow: false },
};

// Prevent static generation — environment check must run at request time
export const dynamic = "force-dynamic";

export default function DevBillingDebugRoute() {
  const isProduction = process.env.NEXT_PUBLIC_APP_ENV === "production";

  if (isProduction) {
    return (
      <div className="min-h-screen bg-[#F2F4F7] flex flex-col items-center justify-center px-6 text-center">
        <p className="text-2xl font-black text-[#0D1B3D] mb-2">
          Collect<span className="text-[#009966]">Boss</span>
        </p>
        <p className="text-sm font-semibold text-gray-600 mb-1">Page not available</p>
        <p className="text-xs text-gray-400">
          The billing debug page is only available in development and staging environments.
        </p>
      </div>
    );
  }

  return <BillingDebugPage />;
}
