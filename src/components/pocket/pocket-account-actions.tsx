"use client";

import Link from "next/link";
import { LogOut } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

export function PocketAccountActions() {
  const { user, signOut, signingOut, signOutError } = useAuth();
  return <section aria-label="Your account" className="pocket-card mt-6 p-5">
    <h2 className="text-sm font-semibold">Your account</h2>
    <p className="mt-1 break-all text-sm text-[var(--pocket-muted)]">{user?.email ?? "Signed-in workspace"}</p>
    <div className="mt-4 flex flex-wrap gap-3">
      <Link href="/support" className="pocket-secondary-action">Help & support</Link>
      <button type="button" disabled={signingOut} onClick={() => void signOut()} className="pocket-secondary-action"><LogOut aria-hidden="true" className="size-4" />{signingOut ? "Signing out…" : "Sign out"}</button>
    </div>
    {signOutError && <p role="alert" className="mt-3 text-sm text-red-700">{signOutError}</p>}
  </section>;
}
