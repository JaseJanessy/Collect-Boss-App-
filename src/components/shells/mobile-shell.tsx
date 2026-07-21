"use client";

import { cn } from "@/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useAuth } from "@/hooks/use-auth";
import {
  Home,
  FolderOpen,
  Plus,
  Zap,
  MoreHorizontal,
  Bell,
} from "lucide-react";
import { DemoBanner } from "@/components/beta/demo-banner";
import { ErrorBoundary } from "@/components/error/error-boundary";
import { EnvModeBadge } from "@/components/ui/env-mode-badge";

const navItems = [
  { href: "/",        label: "Home",    icon: Home },
  { href: "/cases",   label: "Cases",   icon: FolderOpen },
  { href: "/add",     label: "Add",     icon: Plus,  center: true },
  { href: "/actions", label: "Actions", icon: Zap },
  { href: "/more",    label: "More",    icon: MoreHorizontal },
];

interface MobileShellProps {
  children: ReactNode;
  /** Hide the top wordmark — use when the page renders its own header */
  hideHeader?: boolean;
}

export function MobileShell({ children, hideHeader }: MobileShellProps) {
  const pathname  = usePathname();
  const { user }  = useAuth();

  const activeHref = navItems.find((n) => {
    if (n.href === "/") return pathname === "/";
    return pathname.startsWith(n.href);
  })?.href;

  // User initials for avatar
  const initials = user?.name
    ? user.name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)
    : user?.email?.slice(0, 2).toUpperCase() ?? "CB";

  return (
    <div className="cb-mobile-shell flex min-w-0 flex-col h-[100dvh] bg-[#0B1B3A] md:hidden">
      <a
        href="#mobile-main-content"
        className="sr-only fixed left-3 top-3 z-[100] rounded-md bg-white px-3 py-2 text-sm font-semibold text-[#0D1B3D] shadow focus:not-sr-only"
      >
        Skip to main content
      </a>
      {/* Wordmark header */}
      {!hideHeader && (
        <header className="cb-safe-x bg-[#10284E] border-b border-[#244777] pt-[env(safe-area-inset-top)] shrink-0">
          <div className="flex items-center justify-between py-3">
            <div className="flex items-center gap-2">
              <Link href="/">
                <span className="text-[22px] font-black tracking-tight text-white leading-none">
                  Collect<span className="text-[#22C99A]">Boss</span>
                </span>
              </Link>
              {/* Test/Staging mode indicator — hidden in production */}
              <EnvModeBadge />
            </div>

            <div className="flex items-center gap-2">
              {/* Notification bell */}
              <button aria-label="View notifications" className="relative w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors">
                <Bell className="w-4 h-4 text-gray-500" />
                <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
              </button>

              {/* User avatar → More page */}
              <Link href="/more" aria-label="Open account menu">
                <div className="w-8 h-8 rounded-full bg-[#009966] flex items-center justify-center text-white text-xs font-black">
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
      <main id="mobile-main-content" className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain scrollbar-hide">
        <ErrorBoundary context="MobileShell">
          {children}
        </ErrorBoundary>
      </main>

      {/* Bottom nav */}
      <nav className="cb-safe-x bg-[#10284E] border-t border-[#244777] shrink-0 pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-end h-16">
          {navItems.map((item) => {
            const Icon    = item.icon;
            const isActive = activeHref === item.href;

            if (item.center) {
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex-1 flex flex-col items-center pb-2"
                >
                  <div className="w-12 h-12 -mt-6 bg-[#22C99A] rounded-full flex items-center justify-center shadow-lg shadow-[#22C99A]/20">
                    <Icon className="w-5 h-5 text-[#0B1B3A]" />
                  </div>
                  <span className="text-[10px] font-medium text-gray-400 mt-1">
                    {item.label}
                  </span>
                </Link>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors",
                  isActive ? "text-[#009966]" : "text-gray-400"
                )}
              >
                <Icon
                  className={cn(
                    "w-5 h-5 transition-colors",
                    isActive ? "text-[#009966]" : "text-gray-400"
                  )}
                  strokeWidth={isActive ? 2.5 : 1.75}
                />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
