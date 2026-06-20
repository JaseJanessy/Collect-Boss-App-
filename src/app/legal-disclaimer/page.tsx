import type { Metadata } from "next";
import { LegalDisclaimerPage } from "@/components/pages/legal-pages/legal-disclaimer-page";

export const metadata: Metadata = {
  title: "Legal Disclaimer",
  description: "Important limitations and disclaimers about the CollectBoss platform.",
  robots: { index: true, follow: true },
};

export default function LegalDisclaimerRoute() {
  return <LegalDisclaimerPage />;
}
