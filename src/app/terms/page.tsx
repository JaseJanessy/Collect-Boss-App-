import type { Metadata } from "next";
import { TermsPage } from "@/components/pages/legal-pages/terms-page";

export const metadata: Metadata = {
  title: "Terms of Use",
  description: "CollectBoss Terms of Use — please read before using the platform.",
  robots: { index: true, follow: true },
};

export default function TermsRoute() {
  return <TermsPage />;
}
