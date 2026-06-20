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
    <div className="flex flex-col h-[100dvh] bg-[#F2F4F7] lg:hidden">
      {/* Wordmark header */}
      {!hideHeader && (
        <header className="bg-white border-b border-gray-100 px-4 shrink-0">
          <div className="flex items-center justify-between py-3">
            <div className="flex items-center gap-2">
              <Link href="/">
                <span className="text-[22px] font-black tracking-tight text-[#0D1B3D] leading-none">
                  Collect<span className="text-[#009966]">Boss</span>
                </span>
              </Link>
              {/* Test/Staging mode indicator — hidden in production */}
              <EnvModeBadge />
            </div>

            <div className="flex items-center gap-2">
              {/* Notification bell */}
              <button className="relative w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 transition-colors">
                <Bell className="w-4 h-4 text-gray-500" />
                <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
              </button>

              {/* User avatar → More page */}
              <Link href="/more">
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
      <main className="flex-1 overflow-y-auto scrollbar-hide">
        <ErrorBoundary context="MobileShell">
          {children}
        </ErrorBoundary>
      </main>

      {/* Bottom nav */}
      <nav className="bg-white border-t border-gray-100 shrink-0">
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
                  <div className="w-12 h-12 -mt-6 bg-[#009966] rounded-full flex items-center justify-center shadow-lg shadow-emerald-200/60">
                    <Icon className="w-5 h-5 text-white" />
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
