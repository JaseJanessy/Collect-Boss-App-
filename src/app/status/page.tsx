import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, CircleAlert, RefreshCw } from "lucide-react";

import { CollectBossWordmark } from "@/components/brand/wordmark";
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured } from "@/lib/supabase/client";

export const metadata: Metadata = {
  title: "System Status",
  description: "Current availability of CollectBoss and its authentication service.",
  robots: { index: true, follow: true },
};

export const dynamic = "force-dynamic";

async function authenticationAvailable(): Promise<boolean> {
  if (!isSupabaseConfigured) return false;
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: SUPABASE_ANON_KEY },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export default async function StatusPage() {
  const authAvailable = await authenticationAvailable();
  const checkedAt = new Date().toLocaleString("en-MY", { dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Kuala_Lumpur" });

  return (
    <div className="min-h-screen bg-[#F2F4F7]">
      <header className="border-b border-gray-100 bg-white px-5 py-4">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <Link href="/"><CollectBossWordmark /></Link>
          <Link href="/support" className="text-sm font-bold text-[#007A52] hover:underline">Get support</Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-5 py-12">
        <p className="text-xs font-bold uppercase tracking-widest text-[#009966]">Live service check</p>
        <h1 className="mt-2 text-3xl font-black text-[#0D1B3D]">CollectBoss system status</h1>
        <div role="status" className={`mt-7 flex items-center gap-3 rounded-2xl border p-5 ${authAvailable ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
          {authAvailable ? <CheckCircle2 aria-hidden="true" className="h-6 w-6 text-emerald-700" /> : <CircleAlert aria-hidden="true" className="h-6 w-6 text-amber-700" />}
          <div>
            <p className="font-black text-[#0D1B3D]">{authAvailable ? "All checked systems operational" : "Authentication service is degraded"}</p>
            <p className="mt-1 text-sm text-gray-600">Checked {checkedAt} MYT</p>
          </div>
        </div>
        <section aria-labelledby="services-title" className="mt-6 rounded-2xl border border-gray-200 bg-white p-5">
          <h2 id="services-title" className="text-lg font-black text-[#0D1B3D]">Services</h2>
          <div className="mt-4 divide-y divide-gray-100">
            <div className="flex items-center justify-between py-3 text-sm"><span>Web application</span><strong className="text-emerald-700">Operational</strong></div>
            <div className="flex items-center justify-between py-3 text-sm"><span>Authentication</span><strong className={authAvailable ? "text-emerald-700" : "text-amber-700"}>{authAvailable ? "Operational" : "Degraded"}</strong></div>
          </div>
        </section>
        <p className="mt-5 text-xs leading-relaxed text-gray-500">This page checks the public web application and authentication endpoint. It does not expose customer data or internal infrastructure details.</p>
        <Link href="/status" className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-[#0D1B3D] hover:bg-gray-50"><RefreshCw aria-hidden="true" className="h-4 w-4" />Refresh status</Link>
      </main>
    </div>
  );
}
