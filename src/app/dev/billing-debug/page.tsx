/**
 * /dev/billing-debug
 *
 * Development-only billing debug page.
 * Blocked in production via NEXT_PUBLIC_APP_ENV check.
 * Auth is still required (handled by proxy.ts middleware).
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BillingDebugPage } from "@/components/pages/dev/billing-debug-page";

export const metadata: Metadata = {
  title:  "Billing Debug",
  robots: { index: false, follow: false },
};

// Prevent static generation — environment check must run at request time
export const dynamic = "force-dynamic";

export default function DevBillingDebugRoute() {
  if (process.env.NODE_ENV !== "development") notFound();

  return <BillingDebugPage />;
}
