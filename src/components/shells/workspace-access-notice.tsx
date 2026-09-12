"use client";

import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

export function WorkspaceAccessNotice() {
  const { accessError } = useAuth();
  if (!accessError) return null;
  return (
    <section role="alert" className="cb-surface mx-auto my-8 max-w-xl p-6 sm:p-8">
      <AlertCircle aria-hidden="true" className="mb-4 size-6 text-[var(--cb-warning)]" />
      <h1 className="cb-page-title">Workspace temporarily unavailable</h1>
      <p className="cb-page-description">{accessError} We have not confirmed your records or permissions.</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <button onClick={() => window.location.reload()} className="cb-button-primary">Try again</button>
        <Link href="/support" className="cb-button-secondary">Contact support</Link>
      </div>
    </section>
  );
}
