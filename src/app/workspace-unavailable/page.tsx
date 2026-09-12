import Link from "next/link";
import { Building2 } from "lucide-react";
import { AuthShell, AuthCard } from "@/components/pages/auth/auth-shell";

export default function WorkspaceUnavailablePage() {
  return <AuthShell><AuthCard>
    <Building2 aria-hidden="true" className="mb-5 size-8 text-muted-foreground" />
    <h1 className="text-2xl font-semibold">Your workspace could not be opened</h1>
    <p className="mt-3 text-sm leading-6 text-muted-foreground">We could not verify workspace access right now. This does not mean your password is incorrect. No changes have been made by this request.</p>
    <div className="mt-6 flex flex-wrap gap-3">
      <Link href="/" className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 font-semibold text-primary-foreground">Try again</Link>
      <Link href="/support" className="inline-flex min-h-11 items-center rounded-lg border px-4 font-semibold">Contact support</Link>
    </div>
    <div className="mt-6 flex gap-5 text-sm text-primary"><Link href="/status">System status</Link><Link href="/login?error=workspace_unavailable">Sign in again</Link></div>
  </AuthCard></AuthShell>;
}
