import type { Metadata } from "next";
import { SupportPage } from "@/components/pages/legal-pages/support-page";

export const metadata: Metadata = {
  title: "Contact & Support",
  description: "Get help with CollectBoss — billing, account, data, or platform questions.",
  robots: { index: true, follow: true },
};

export default function SupportRoute() {
  return <SupportPage />;
}
