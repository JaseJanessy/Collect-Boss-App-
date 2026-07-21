"use client";

import { cn } from "@/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useAuth } from "@/hooks/use-auth";
import {
  LayoutDashboard,
  FolderOpen,
  Zap,
  FileText,
  CreditCard,
  FileSpreadsheet,
  BarChart2,
  Settings,
  ChevronRight,
  Bell,
  Search,
  LogOut,
  Receipt,
  UserRound,
} from "lucide-react";
import { DemoBanner } from "@/components/beta/demo-banner";
import { ErrorBoundary } from "@/components/error/error-boundary";
import { SidebarEnvBadge } from "@/components/ui/env-mode-badge";

const sidebarItems = [
  { href: "/",          label: "Dashboard", icon: LayoutDashboard },
  { href: "/cases",     label: "Cases",     icon: FolderOpen },
  { href: "/debtors",   label: "Debtors",   icon: UserRound },
  { href: "/actions",   label: "Actions",   icon: Zap },
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/payments",  label: "Payments",  icon: CreditCard },
  { href: "/statements", label: "Statements", icon: FileSpreadsheet },
  { href: "/reports",   label: "Reports",   icon: BarChart2 },
  { href: "/billing",   label: "Billing",   icon: Receipt },
  { href: "/settings",  label: "Settings",  icon: Settings },
];

interface DashboardShellProps {
  children: ReactNode;
}

export function DashboardShell({ children }: DashboardShellProps) {
  const pathname = usePathname();
  const { user, signOut } = useAuth();

  const initials = user?.name
    ? user.name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)
    : user?.email?.slice(0, 2).toUpperCase() ?? "CB";

  const displayName = user?.name ?? user?.email ?? "Demo User";

  return (
    <div className="cb-dashboard-shell hidden min-w-0 md:flex h-[100dvh] bg-[#0B1B3A] overflow-hidden">
      <a
        href="#dashboard-main-content"
        className="sr-only fixed left-3 top-3 z-[100] rounded-md bg-white px-3 py-2 text-sm font-semibold text-[#0D1B3D] shadow focus:not-sr-only"
      >
        Skip to main content
      </a>
      {/* Sidebar */}
      <aside className="w-16 lg:w-56 bg-[#0B1B3A] flex flex-col shrink-0 transition-[width]">
        {/* Logo */}
        <div className="px-3 lg:px-5 py-5 border-b border-white/10 text-center lg:text-left">
          <Link href="/">
            <span className="hidden lg:inline text-xl font-black tracking-tight text-white">
              Collect<span className="text-[#009966]">Boss</span>
            </span>
            <span className="lg:hidden text-lg font-black tracking-tight text-white">
              C<span className="text-[#009966]">B</span>
            </span>
          </Link>
          <p className="hidden lg:block text-[10px] text-blue-300 mt-0.5 font-medium">
            Collect Smart. Recover Better.
          </p>
          <span className="hidden lg:inline-block mt-1.5 text-[9px] font-bold text-amber-300 bg-amber-900/40 border border-amber-700/30 px-1.5 py-0.5 rounded-full tracking-wide">
            PRIVATE BETA
          </span>
        </div>

        {/* Test/Staging mode indicator — hidden in production */}
        <SidebarEnvBadge />

        {/* Nav */}
        <nav className="flex-1 min-h-0 px-2 lg:px-3 py-4 space-y-0.5 overflow-y-auto scrollbar-hide">
          {sidebarItems.map((item) => {
            const Icon    = item.icon;
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center justify-center lg:justify-start gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all",
                  isActive
                    ? "bg-[#009966] text-white shadow-sm"
                    : "text-blue-100 hover:bg-white/8 hover:text-white"
                )}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                <span className="hidden lg:inline">{item.label}</span>
                {isActive && (
                  <ChevronRight className="hidden lg:block w-3.5 h-3.5 ml-auto opacity-60" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* User + logout */}
        <div className="px-2 lg:px-3 py-4 border-t border-white/10">
          <div className="flex items-center justify-center lg:justify-start gap-3 px-3 py-2 rounded-xl hover:bg-white/8 cursor-pointer transition-colors">
            <div className="w-8 h-8 rounded-full bg-[#009966] flex items-center justify-center text-white text-xs font-bold shrink-0">
              {initials}
            </div>
            <div className="hidden lg:block flex-1 min-w-0">
              <p className="text-sm font-semibold text-white truncate">
                {displayName}
              </p>
              <p className="text-[10px] text-blue-300 truncate">Pro Plan</p>
            </div>
          </div>

          {/* Logout button */}
          <button
            onClick={() => signOut()}
            className="mt-1 w-full flex items-center justify-center lg:justify-start gap-2 px-3 py-2 rounded-xl text-xs font-medium text-red-300 hover:bg-red-900/30 hover:text-red-200 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="bg-[#10284E] border-b border-[#244777] px-4 lg:px-6 py-3 flex items-center gap-4 shrink-0">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              aria-label="Search cases and debtors"
              placeholder="Search cases, debtors..."
              className="w-full pl-9 pr-4 py-2 bg-[#0D2143] rounded-lg text-sm text-white placeholder:text-[#8FA6CC] outline-none focus:ring-2 focus:ring-[#22C99A]/30 border border-[#244777] focus:border-[#22C99A] transition-all"
            />
          </div>
          <button aria-label="View notifications" className="relative w-9 h-9 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors">
            <Bell className="w-4 h-4 text-gray-600" />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full" />
          </button>
          <div className="w-8 h-8 rounded-full bg-[#009966] flex items-center justify-center text-white text-xs font-bold">
            {initials}
          </div>
        </header>

        {/* Demo banner */}
        <DemoBanner />

        {/* Content */}
        <main id="dashboard-main-content" className="flex-1 min-h-0 min-w-0 overflow-y-auto overscroll-contain scrollbar-hide p-4 lg:p-6">
          <ErrorBoundary context="DashboardShell">
            {children}
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
