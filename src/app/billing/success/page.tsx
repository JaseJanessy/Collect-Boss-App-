import type { Metadata } from "next";
import { BillingSuccessStatus } from "@/components/pages/billing-success-page";

export const metadata: Metadata = {
  title: "Payment confirmation",
  robots: { index: false },
};

export default function BillingSuccessPage() {
  return <BillingSuccessStatus />;
}
