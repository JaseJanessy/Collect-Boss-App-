import type { Metadata } from "next";
import { PrivacyPage } from "@/components/pages/legal-pages/privacy-page";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How CollectBoss collects, uses, and protects your personal data under the PDPA 2010.",
  robots: { index: true, follow: true },
};

export default function PrivacyRoute() {
  return <PrivacyPage />;
}
