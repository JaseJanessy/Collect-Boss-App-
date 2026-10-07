"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { trackError } from "@/lib/analytics/tracker";
import { DashboardShell } from "@/components/shells/dashboard-shell";
import { MobileShell } from "@/components/shells/mobile-shell";
import { useT } from "@/contexts/language-context";

interface Props {
  error: Error & { digest?: string };
  reset: () => void;
  section: string;
}

function SectionErrorCard({ reset, digest }: { reset: () => void; digest?: string }) {
  const t = useT();
  return (
    <div role="alert" className="mx-auto mt-6 w-full max-w-md rounded-2xl border border-red-200 bg-white p-6 text-center shadow-sm">
      <p className="text-lg font-black text-[#0D1B3D]">{t("error.pageTitle")}</p>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        {t("error.pageBody")}
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--cb-action-primary)] px-5 py-2.5 text-sm font-bold text-white"
      >
        <RefreshCw className="size-4" aria-hidden="true" />{t("common.tryAgain")}
      </button>
      <Link href="/" className="mt-3 block text-sm font-semibold text-slate-500 hover:text-slate-700">{t("common.goToDashboard")}</Link>
      {digest && <p className="mt-4 font-mono text-[10px] text-slate-300">Error ID: {digest}</p>}
    </div>
  );
}

/** Route-level error UI that keeps navigation available so users can recover. */
export function SectionError({ error, reset, section }: Props) {
  useEffect(() => {
    trackError(error, { page: section, digest: error.digest });
  }, [error, section]);

  return (
    <>
      <MobileShell>
        <div className="px-4"><SectionErrorCard reset={reset} digest={error.digest} /></div>
      </MobileShell>
      <DashboardShell>
        <SectionErrorCard reset={reset} digest={error.digest} />
      </DashboardShell>
    </>
  );
}
