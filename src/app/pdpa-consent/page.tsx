import type { Metadata } from "next";
import { PdpaConsentPage } from "@/components/pages/legal-pages/pdpa-consent-page";

export const metadata: Metadata = {
  title: "PDPA Consent Notice",
  description: "Personal Data Protection Notice under the Personal Data Protection Act 2010 (Malaysia).",
  robots: { index: true, follow: true },
};

export default function PdpaConsentRoute() {
  return <PdpaConsentPage />;
}
