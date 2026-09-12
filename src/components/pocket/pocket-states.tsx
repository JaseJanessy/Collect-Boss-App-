import Link from "next/link";
import { AlertCircle, Inbox, LockKeyhole } from "lucide-react";
import { CollectBossPocketWordmark } from "@/components/brand/pocket-wordmark";
import { pocketCssVariables } from "@/lib/brand/pocket-theme";
import { pocketPrimaryActionClass } from "./pocket-ui";

export function PocketEmptyState({ title, message, action }: { title: string; message: string; action?: React.ReactNode }) {
  return (
    <div className="pocket-card border-dashed p-8 text-center sm:p-12">
      <Inbox aria-hidden="true" className="mx-auto size-10 text-emerald-700" />
      <h2 className="mt-4 text-lg font-black text-[#092F2A]">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">{message}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function PocketPermissionDenied() {
  return (
    <section aria-label="Pocket access" className="pocket-root flex min-h-[70dvh] items-center justify-center p-6" data-pocket-theme style={pocketCssVariables}>
      <div className="pocket-card w-full max-w-md p-8 text-center">
        <CollectBossPocketWordmark className="mx-auto mb-5" />
        <LockKeyhole aria-hidden="true" className="mx-auto size-10 text-[#087F5B]" />
        <h1 className="mt-4 text-2xl font-black text-[#092F2A]">Pocket isn&apos;t available here</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">Open the product assigned to your signed-in business. No other business information has been shown.</p>
        <Link href="/" className={`${pocketPrimaryActionClass} mt-6`}>
          Return home
        </Link>
      </div>
    </section>
  );
}

export function PocketUnavailable({ retryHref = "/pocket" }: { retryHref?: string }) {
  return (
    <section aria-label="Pocket unavailable" className="pocket-root flex min-h-[70dvh] items-center justify-center p-6" data-pocket-theme style={pocketCssVariables}>
      <div role="alert" className="pocket-card w-full max-w-md border-red-200 p-8 text-center">
        <AlertCircle aria-hidden="true" className="mx-auto size-10 text-red-700" />
        <h1 className="mt-4 text-2xl font-black text-slate-950">Pocket couldn&apos;t open</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">We couldn&apos;t verify your business access. Try again without changing your sign-in details.</p>
        <Link href={retryHref} className={`${pocketPrimaryActionClass} mt-6`}>
          Try again
        </Link>
        <p className="mt-4 text-sm"><Link href="/support" className="text-[var(--pocket-action-primary)] underline underline-offset-4">Contact support</Link></p>
      </div>
    </section>
  );
}
