"use client";

import { cn } from "@/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useShellViewport } from "@/hooks/use-shell-viewport";
import { DemoBanner } from "@/components/beta/demo-banner";
import { ErrorBoundary } from "@/components/error/error-boundary";
import { EnvModeBadge } from "@/components/ui/env-mode-badge";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { activePrimaryNavigation, navigationItemIsVisible, primaryNavigation } from "@collectboss/navigation";
import { NavigationIcon } from "@/components/navigation/navigation-icon";
import { CollectBossWordmark } from "@/components/brand/wordmark";
import { WorkspaceAccessNotice } from "./workspace-access-notice";
import { useT } from "@/contexts/language-context";
import { navigationGroupLabel, navigationLabel } from "@/lib/i18n/messages";

interface MobileShellProps {
  children: ReactNode;
  /** Hide the top wordmark — use when the page renders its own header */
  hideHeader?: boolean;
}

export function MobileShell({ children, hideHeader }: MobileShellProps) {
  const pathname  = usePathname();
  const t = useT();
  const { user, permissions, workspace, accessError }  = useAuth();
  const viewport = useShellViewport();
  const activeItem = activePrimaryNavigation(pathname);
  const visibleItems = primaryNavigation.filter((item) => navigationItemIsVisible(item, permissions));

  // The page also renders DashboardShell; only the visible shell mounts the page.
  if (viewport === "desktop") return null;
  const active = viewport === "mobile";

  // User initials for avatar
  const initials = user?.name
    ? user.name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)
    : user?.email?.slice(0, 2).toUpperCase() ?? "CB";

  return (
    <div className="cb-mobile-shell flex min-w-0 flex-col h-[100dvh] bg-[var(--cb-background)] md:hidden">
      <a
        href="#mobile-main-content"
        className="sr-only fixed left-3 top-3 z-[100] rounded-md bg-white px-3 py-2 text-sm font-semibold text-[#0D1B3D] shadow focus:not-sr-only"
      >
        Skip to main content
      </a>
      {/* Wordmark header */}
      {!hideHeader && (
        <header className="cb-safe-x bg-white border-b border-[var(--cb-border)] pt-[env(safe-area-inset-top)] shrink-0">
          <div className="flex items-center justify-between py-3">
            <div className="flex items-center gap-2">
              <Link href="/" className="flex min-h-11 flex-col justify-center gap-0.5">
                <CollectBossWordmark compact />
                <span className="max-w-44 truncate text-xs text-[var(--cb-text-secondary)]">{workspace?.workspace.name ?? "Collections workspace"}</span>
              </Link>
              {/* Test/Staging mode indicator — hidden in production */}
              <EnvModeBadge />
            </div>

            <div className="flex items-center gap-2">
              {/* Notification bell */}
              {active && <NotificationBell mobile />}

              {/* User avatar → More page */}
              <Link href="/more" aria-label="Open More and Settings" className="flex size-11 items-center justify-center">
                <div className="w-8 h-8 rounded-full bg-[var(--cb-action-primary)] flex items-center justify-center text-white text-xs font-black">
                  {initials}
                </div>
              </Link>
            </div>
          </div>
        </header>
      )}

      {/* Demo banner */}
      <DemoBanner />

      {/* Scrollable content */}
      <main id="mobile-main-content" tabIndex={-1} className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain">
        <ErrorBoundary context="MobileShell">
          {active && (accessError ? <WorkspaceAccessNotice /> : children)}
        </ErrorBoundary>
      </main>

      {/* Bottom nav */}
      <nav aria-label="Primary navigation" className="cb-safe-x bg-white border-t border-[var(--cb-border)] shrink-0 pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-stretch h-16">
          {visibleItems.map((item) => {
            const isActive = activeItem?.id === item.id;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-label={navigationLabel(t, item)}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "min-w-0 flex-1 flex flex-col items-center justify-center gap-1 px-0.5 py-2 text-[11px] font-medium text-center leading-tight transition-colors",
                  isActive ? "text-[var(--cb-action-primary)]" : "text-[var(--cb-text-secondary)]"
                )}
              >
                <NavigationIcon
                  name={item.icon}
                  className={cn(
                    "w-5 h-5 transition-colors",
                    isActive ? "text-[var(--cb-action-primary)]" : "text-[var(--cb-text-secondary)]"
                  )}
                />
                <span className="w-full">{navigationLabel(t, item)}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
