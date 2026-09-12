"use client";

import { useEffect } from "react";
import { AlertCircle } from "lucide-react";

export default function PocketError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  useEffect(() => {
    console.error("[pocket-shell] route rendering failed", error.digest ?? "no-digest");
  }, [error]);

  return (
    <div role="alert" className="mx-auto max-w-lg rounded-3xl border border-red-200 bg-white p-8 text-center shadow-sm">
      <AlertCircle aria-hidden="true" className="mx-auto size-10 text-red-700" />
      <h1 className="mt-4 text-2xl font-black text-slate-950">Something went wrong</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">Pocket couldn&apos;t show this page. Your information was not changed.</p>
      <button type="button" onClick={unstable_retry} className="pocket-primary-action mt-6">
        Try again
      </button>
    </div>
  );
}
