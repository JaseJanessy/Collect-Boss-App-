import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/contexts/auth-context";
import { BetaProvider } from "@/contexts/beta-context";
import { ProfileGuard } from "@/components/layout/profile-guard";
import { FeedbackButton } from "@/components/beta/feedback-button";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "CollectBoss — Collect Smart. Recover Better.",
    template: "%s | CollectBoss",
  },
  description:
    "CollectBoss helps Malaysian SMEs manage debt collection, track cases, send reminders, and recover payments professionally.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "CollectBoss",
  },
  icons: {
    icon:    "/favicon.svg",
    apple:   "/icons/icon-192.png",
    shortcut: "/favicon.svg",
  },
  keywords: ["debt collection", "Malaysia", "SME", "invoice", "payment recovery", "CollectBoss"],
  authors: [{ name: "CollectBoss" }],
  robots: { index: false, follow: false }, // Keep app private from search engines
};

export const viewport: Viewport = {
  themeColor: "#0B1B3A",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en-MY"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
      </head>
      <body className="cb-app-theme min-h-full bg-[#0B1B3A]">
        <AuthProvider>
          <BetaProvider>
            <ProfileGuard>
              {children}
            </ProfileGuard>
            <FeedbackButton />
          </BetaProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
