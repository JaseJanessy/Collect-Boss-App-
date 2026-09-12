import type { Metadata } from "next";
import { LandingPage } from "@/components/pages/landing-page";

export const metadata: Metadata = {
  title: "CollectBoss — Collect Overdue Payments Professionally",
  description:
    "CollectBoss helps Malaysian SMEs record debts, send professional reminders, manage payment proof, and prepare recovery documents. Start free today.",
  keywords: [
    "debt collection Malaysia",
    "invoice recovery SME",
    "payment reminder Malaysia",
    "overdue payment tracking",
    "case evidence export Malaysia",
    "formal payment reminder Malaysia",
    "CollectBoss",
  ],
  openGraph: {
    title:       "CollectBoss — Collect Overdue Payments Professionally",
    description: "Built for Malaysian SMEs. Record debts, send reminders, manage payment proof, and prepare recovery documents.",
    type:        "website",
    locale:      "en_MY",
  },
  robots: {
    index:  true,
    follow: true,
  },
};

export default function LandingRoute() {
  return <LandingPage />;
}
