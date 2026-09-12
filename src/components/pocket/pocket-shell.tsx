"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { LogOut, WifiOff, ArrowUpRight, CircleHelp } from "lucide-react";

import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { activePocketNavigation, pocketPrimaryNavigation } from "@collectboss/pocket-navigation";
import { CollectBossPocketWordmark } from "@/components/brand/pocket-wordmark";
import { pocketCssVariables } from "@/lib/brand/pocket-theme";
import { PocketNavigationIcon } from "./pocket-navigation-icon";
import { usePocketWorkspace } from "./pocket-workspace-provider";
import { workspacePlanLabel } from "@/lib/workspace/presentation";

export function PocketShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const active = activePocketNavigation(pathname);
  const { signOut, signingOut, signOutError } = useAuth();
  const context = usePocketWorkspace();
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  return (
    <div className="pocket-root min-h-[100dvh] text-slate-950 lg:flex" data-pocket-shell data-pocket-theme style={pocketCssVariables}>
      <a href="#pocket-main-content" className="sr-only fixed left-3 top-3 z-[100] rounded-xl bg-white px-4 py-3 font-black text-[#082C32] shadow-lg focus:not-sr-only">
        Skip to main content
      </a>

      <aside className="hidden h-[100dvh] w-64 shrink-0 flex-col border-r border-white/10 bg-[var(--pocket-brand-navy)] text-white lg:sticky lg:top-0 lg:flex">
        <Link href="/pocket" className="flex min-h-20 flex-col items-start justify-center gap-1 border-b border-white/10 px-6" aria-label="CollectBoss Pocket home">
          <CollectBossPocketWordmark variant="dark" compact />
          <span className="text-xs text-slate-300">Your daily ledger</span>
        </Link>

        <nav aria-label="Pocket primary navigation" className="flex-1 min-h-0 space-y-1 overflow-y-auto px-3 py-5">
          <p className="cb-sidebar-label">Workspace</p>
          {pocketPrimaryNavigation.map((item) => {
            const selected = active?.id === item.id;
            return (
              <Link
                key={item.id}
                href={item.href}
                aria-current={selected ? "page" : undefined}
                title={item.label}
                className={cn(
                  "cb-sidebar-link focus-visible:ring-2 focus-visible:ring-[var(--pocket-focus)] motion-reduce:transition-none",
                  selected ? "cb-sidebar-link-active" : "text-slate-300 hover:bg-white/10 hover:text-white",
                )}
              >
                <PocketNavigationIcon name={item.icon} className="size-4 shrink-0" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-white/10 p-3">
          <div className="px-3 py-3"><p className="truncate text-sm font-medium">{context.workspace.name}</p><p className="mt-1 text-xs text-slate-300">{workspacePlanLabel(context.plan.slug)}</p></div>
          <Link href="/pocket/upgrade" className="cb-sidebar-link text-slate-300 hover:bg-white/10"><ArrowUpRight aria-hidden="true" className="size-4" />Explore Main workspace</Link>
          <Link href="/support" className="cb-sidebar-link text-slate-300 hover:bg-white/10"><CircleHelp aria-hidden="true" className="size-4" />Help & support</Link>
          <button type="button" disabled={signingOut} onClick={() => signOut()} aria-label="Sign out of CollectBoss Pocket" className="cb-sidebar-link w-full text-slate-300 hover:bg-white/10">
            <LogOut aria-hidden="true" className="size-5" />
            <span>{signingOut ? "Signing out…" : "Sign out"}</span>
          </button>
          {signOutError && <p role="alert" className="mt-2 px-3 text-xs text-red-200">{signOutError}</p>}
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="pocket-topbar sticky top-0 z-30 min-h-20 border-b border-[var(--pocket-line)] bg-white px-4 py-3 sm:px-6 lg:px-8">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
            <Link href="/pocket" className="flex min-h-12 min-w-0 flex-col items-start justify-center gap-1 rounded-lg" aria-label="CollectBoss Pocket home">
              <CollectBossPocketWordmark compact />
              <span className="block max-w-[13rem] truncate text-xs font-bold text-[var(--pocket-muted)] sm:max-w-sm">{context.workspace.name}</span>
            </Link>
            <Link href="/pocket/billing" className="shrink-0 inline-flex min-h-11 items-center rounded-lg border border-[var(--pocket-line)] px-3 py-2 text-xs font-medium text-[var(--pocket-ink)]" aria-label={`Current plan: ${workspacePlanLabel(context.plan.slug)}`}>
              {workspacePlanLabel(context.plan.slug)}
            </Link>
          </div>
        </header>

        {!online ? (
          <div role="alert" aria-live="assertive" className="flex items-center justify-center gap-2 border-b border-amber-300 bg-amber-50 px-4 py-3 text-center text-sm font-bold text-amber-950">
            <WifiOff aria-hidden="true" className="size-4 shrink-0" />
            You&apos;re offline. Unsaved changes may not be sent.
          </div>
        ) : null}

        {context.workspace.lifecycleState !== "active" ? (
          <div role="status" className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm font-semibold text-amber-950">
            This Pocket workspace is read-only. Your information remains available.
          </div>
        ) : null}

        <main id="pocket-main-content" tabIndex={-1} className="mx-auto w-full max-w-7xl px-4 py-5 pb-28 sm:px-6 sm:py-7 lg:px-8 lg:py-9 lg:pb-10">
          {children}
        </main>
      </div>

      <nav aria-label="Pocket primary navigation" className="pocket-bottom-nav fixed inset-x-0 bottom-0 z-40 border-t border-[var(--pocket-line)] bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-10px_30px_rgb(13_27_61_/_0.08)] lg:hidden">
        <div className="grid min-h-20 grid-cols-5 px-1 sm:px-4">
          {pocketPrimaryNavigation.map((item) => {
            const selected = active?.id === item.id;
            const isAdd = item.id === "add";
            return (
              <Link
                key={item.id}
                href={item.href}
                aria-label={item.label}
                aria-current={selected ? "page" : undefined}
                className={cn(
                  "flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-1 py-1 text-xs font-medium leading-tight",
                  selected ? "text-[var(--pocket-action-primary)]" : "text-[var(--pocket-muted)]",
                )}
              >
                <span className={cn("flex size-8 items-center justify-center rounded-lg", selected && !isAdd && "bg-[var(--pocket-selected-surface)]", isAdd && "bg-[var(--pocket-action-primary)] text-white")}>
                  <PocketNavigationIcon name={item.icon} className={isAdd ? "size-6" : "size-5"} />
                </span>
                <span className="max-w-full truncate">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
