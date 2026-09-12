"use client";

import { cn } from "@/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useAuth } from "@/hooks/use-auth";
import {
  ChevronRight,
  LogOut,
} from "lucide-react";
import { DemoBanner } from "@/components/beta/demo-banner";
import { ErrorBoundary } from "@/components/error/error-boundary";
import { SidebarEnvBadge } from "@/components/ui/env-mode-badge";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { GlobalSearch } from "@/components/operations/global-search";
import { activePrimaryNavigation, navigationItemIsVisible, primaryNavigation, secondaryNavigation } from "@collectboss/navigation";
import { NavigationIcon } from "@/components/navigation/navigation-icon";
import { CollectBossWordmark } from "@/components/brand/wordmark";
import { workspacePlanLabel } from "@/lib/workspace/presentation";
import { WorkspaceAccessNotice } from "./workspace-access-notice";

interface DashboardShellProps {
  children: ReactNode;
}

export function DashboardShell({ children }: DashboardShellProps) {
  const pathname = usePathname();
  const { user, signOut, permissions, workspace, accessLoading, accessError, isConfigured, signingOut, signOutError } = useAuth();
  const activeItem = activePrimaryNavigation(pathname);
  const visibleItems = primaryNavigation.filter((item) => navigationItemIsVisible(item, permissions));
  const resourceItems = secondaryNavigation.filter((item) => item.group === "Workspace" && navigationItemIsVisible(item, permissions));
  const accountItems = secondaryNavigation.filter((item) => ["settings", "billing", "support"].includes(item.id) && navigationItemIsVisible(item, permissions));
  const secondaryActive = secondaryNavigation.find((item) => !item.href.includes("#") && (pathname === item.href || pathname.startsWith(`${item.href}/`)));

  const initials = user?.name
    ? user.name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)
    : user?.email?.slice(0, 2).toUpperCase() ?? "CB";

  const displayName = user?.name ?? user?.email ?? "Your account";
  const workspaceName = workspace?.workspace.name ?? (isConfigured ? "Your workspace" : "Development preview");

  return (
    <div className="cb-dashboard-shell hidden min-w-0 md:flex h-[100dvh] bg-[var(--cb-surface-inverse)] overflow-hidden">
      <a
        href="#dashboard-main-content"
        className="sr-only fixed left-3 top-3 z-[100] rounded-md bg-white px-3 py-2 text-sm font-semibold text-[#0D1B3D] shadow focus:not-sr-only"
      >
        Skip to main content
      </a>
      {/* Sidebar */}
      <aside className="w-20 lg:w-64 bg-[var(--cb-surface-inverse)] flex flex-col shrink-0 transition-[width]">
        {/* Logo */}
        <div className="flex min-h-20 flex-col justify-center px-3 lg:px-6 border-b border-white/10 text-center lg:text-left">
          <Link href="/">
            <CollectBossWordmark variant="dark" className="hidden lg:inline-flex" />
            <span aria-label="CollectBoss" className="inline-flex rounded-md bg-[var(--cb-surface)] px-2 py-1 text-lg font-black tracking-tight lg:hidden">
              <span aria-hidden="true" className="text-[var(--cb-brand-navy)]">C</span><span aria-hidden="true" className="text-[var(--cb-brand-green)]">B</span>
            </span>
          </Link>
          <p className="hidden lg:block text-xs text-slate-300 mt-1">
            Collections workspace
          </p>
        </div>

        {/* Test/Staging mode indicator — hidden in production */}
        <SidebarEnvBadge />

        {/* Nav */}
        <div className="flex-1 min-h-0 overflow-y-auto px-3 py-5">
        <p className="cb-sidebar-label">Overview</p>
        <nav aria-label="Primary navigation" className="space-y-1">
          {visibleItems.map((item) => {
            const isActive = !secondaryActive && activeItem?.id === item.id;
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "cb-sidebar-link",
                  isActive
                    ? "cb-sidebar-link-active"
                    : "text-slate-300 hover:bg-white/8 hover:text-white"
                )}
                >
                  <NavigationIcon name={item.icon} className="w-4 h-4 shrink-0" />
                <span className="hidden lg:inline">{item.label}</span>
                {isActive && (
                  <ChevronRight className="hidden lg:block w-3.5 h-3.5 ml-auto opacity-60" />
                )}
              </Link>
            );
          })}
        </nav>
        {resourceItems.length > 0 && <>
          <p className="cb-sidebar-label mt-7">Workspace</p>
          <nav aria-label="Workspace resources" className="space-y-1">
            {resourceItems.map((item) => <Link key={item.id} href={item.href} title={item.label} aria-current={secondaryActive?.id === item.id ? "page" : undefined} className={cn("cb-sidebar-link", secondaryActive?.id === item.id ? "cb-sidebar-link-active" : "text-slate-300 hover:bg-white/8 hover:text-white")}><NavigationIcon name={item.icon} className="size-4 shrink-0" /><span className="hidden lg:inline">{item.label}</span></Link>)}
          </nav>
        </>}
        <p className="cb-sidebar-label mt-7">Manage</p>
        <nav aria-label="Account and support" className="space-y-1">
          {accountItems.map((item) => <Link key={item.id} href={item.href} title={item.label} aria-current={secondaryActive?.id === item.id ? "page" : undefined} className={cn("cb-sidebar-link", secondaryActive?.id === item.id ? "cb-sidebar-link-active" : "text-slate-300 hover:bg-white/8 hover:text-white")}><NavigationIcon name={item.icon} className="size-4 shrink-0" /><span className="hidden lg:inline">{item.label}</span></Link>)}
        </nav>
        </div>

        {/* User + logout */}
        <div className="px-2 lg:px-3 py-4 border-t border-white/10">
          <div className="mb-3 hidden px-3 lg:block">
            <p className="truncate text-sm font-medium text-white" title={workspaceName}>{workspaceName}</p>
            <p className="mt-1 text-xs text-slate-300">{!isConfigured ? "Local demonstration" : accessLoading ? "Verifying workspace…" : workspacePlanLabel(workspace?.plan.slug)}</p>
          </div>
          <Link
            href="/more"
            aria-label="Open More and Settings"
            className="flex items-center justify-center lg:justify-start gap-3 px-3 py-2 rounded-xl hover:bg-white/8 transition-colors"
          >
            <div className="w-8 h-8 rounded-full bg-[var(--cb-action-primary)] flex items-center justify-center text-white text-xs font-bold shrink-0">
              {initials}
            </div>
            <div className="hidden lg:block flex-1 min-w-0">
              <p className="text-sm font-semibold text-white truncate">
                {displayName}
              </p>
              <p className="text-xs text-slate-300 truncate">Account & preferences</p>
            </div>
          </Link>

          {/* Logout button */}
          <button
            onClick={() => signOut()}
            disabled={signingOut}
            aria-label="Sign out"
            className="mt-1 min-h-11 w-full flex items-center justify-center lg:justify-start gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-300 hover:bg-white/8 hover:text-white transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">{signingOut ? "Signing out…" : "Sign Out"}</span>
          </button>
          {signOutError && <p role="alert" className="mt-2 px-2 text-xs text-red-200">{signOutError}</p>}
        </div>
      </aside>

      {/* Main area */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="cb-workspace-chrome min-h-20 bg-white border-b border-slate-200 px-5 lg:px-8 py-3 flex items-center gap-5 shrink-0">
          <div className="hidden min-w-0 w-48 shrink-0 xl:block">
            <p className="truncate text-xs text-slate-500">CollectBoss Main</p>
            <p className="mt-0.5 truncate text-sm font-semibold text-slate-900">{secondaryActive?.label ?? activeItem?.label ?? "Workspace"}</p>
          </div>
          <GlobalSearch />
          <NotificationBell />
          <Link href="/more" aria-label="Open account and preferences" className="size-11 shrink-0 rounded-full border border-[var(--cb-border)] bg-[var(--cb-surface-muted)] flex items-center justify-center text-[var(--cb-text-primary)] text-xs font-semibold">
            {initials}
          </Link>
        </header>

        {/* Demo banner */}
        <DemoBanner />

        {/* Content */}
        <main id="dashboard-main-content" tabIndex={-1} className="cb-workspace-chrome flex-1 min-h-0 min-w-0 overflow-y-auto overscroll-contain bg-[var(--cb-background)] p-5 lg:p-8">
          <ErrorBoundary context="DashboardShell">
            {accessError ? <WorkspaceAccessNotice /> : children}
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
