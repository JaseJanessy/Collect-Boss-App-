import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { AuthProvider } from "@/contexts/auth-context";
import { BetaProvider } from "@/contexts/beta-context";
import { ProfileGuard } from "@/components/layout/profile-guard";
import { FeedbackButton } from "@/components/beta/feedback-button";
import { RegionProvider } from "@/contexts/region-context";
import { brandCssVariables, brandTokens } from "@/lib/brand/theme";

const corporateSans = localFont({
  src: [
    { path: "../../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2", weight: "400" },
    { path: "../../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-500-normal.woff2", weight: "500" },
    { path: "../../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2", weight: "600" },
    { path: "../../node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-700-normal.woff2", weight: "700" },
  ],
  variable: "--font-corporate-sans",
  display: "swap",
});

const corporateMono = localFont({
  src: [
    { path: "../../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2", weight: "400" },
    { path: "../../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2", weight: "500" },
    { path: "../../node_modules/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff2", weight: "600" },
  ],
  variable: "--font-corporate-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "CollectBoss — Collect Smart. Recover Better.",
    template: "%s | CollectBoss",
  },
  description:
    "CollectBoss helps Malaysian SMEs manage debt collection, track cases, send reminders, and recover payments professionally.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "CollectBoss",
  },
  icons: {
    icon: "/brand/icon.svg",
    apple: "/brand/icon-192.png",
    shortcut: "/brand/icon.svg",
  },
  keywords: ["debt collection", "Malaysia", "SME", "invoice", "payment recovery", "CollectBoss"],
  authors: [{ name: "CollectBoss" }],
  robots: { index: false, follow: false }, // Keep app private from search engines
};

export const viewport: Viewport = {
  themeColor: brandTokens.brand.navy,
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
      className={`${corporateSans.variable} ${corporateMono.variable} h-full antialiased`}
      style={brandCssVariables}
    >
      <head>
        <link rel="apple-touch-icon" href="/brand/icon-192.png" />
      </head>
      <body className="cb-app-theme min-h-full bg-[var(--cb-background)]">
        <AuthProvider>
          <RegionProvider>
            <BetaProvider>
              <ProfileGuard>
                {children}
              </ProfileGuard>
              <FeedbackButton />
            </BetaProvider>
          </RegionProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
