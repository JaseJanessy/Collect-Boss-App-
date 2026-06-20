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
  BarChart2,
  Settings,
  ChevronRight,
  Bell,
  Search,
  LogOut,
  Receipt,
} from "lucide-react";
import { DemoBanner } from "@/components/beta/demo-banner";
import { ErrorBoundary } from "@/components/error/error-boundary";
import { SidebarEnvBadge } from "@/components/ui/env-mode-badge";

const sidebarItems = [
  { href: "/",          label: "Dashboard", icon: LayoutDashboard },
  { href: "/cases",     label: "Cases",     icon: FolderOpen },
  { href: "/actions",   label: "Actions",   icon: Zap },
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/payments",  label: "Payments",  icon: CreditCard },
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
    <div className="hidden lg:flex h-screen bg-[#F2F4F7] overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 bg-[#0D1B3D] flex flex-col shrink-0">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-white/10">
          <Link href="/">
            <span className="text-xl font-black tracking-tight text-white">
              Collect<span className="text-[#009966]">Boss</span>
            </span>
          </Link>
          <p className="text-[10px] text-blue-300 mt-0.5 font-medium">
            Collect Smart. Recover Better.
          </p>
          <span className="inline-block mt-1.5 text-[9px] font-bold text-amber-300 bg-amber-900/40 border border-amber-700/30 px-1.5 py-0.5 rounded-full tracking-wide">
            PRIVATE BETA
          </span>
        </div>

        {/* Test/Staging mode indicator — hidden in production */}
        <SidebarEnvBadge />

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto scrollbar-hide">
          {sidebarItems.map((item) => {
            const Icon    = item.icon;
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all",
                  isActive
                    ? "bg-[#009966] text-white shadow-sm"
                    : "text-blue-100 hover:bg-white/8 hover:text-white"
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {item.label}
                {isActive && (
                  <ChevronRight className="w-3.5 h-3.5 ml-auto opacity-60" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* User + logout */}
        <div className="px-3 py-4 border-t border-white/10">
          <div className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-white/8 cursor-pointer transition-colors">
            <div className="w-8 h-8 rounded-full bg-[#009966] flex items-center justify-center text-white text-xs font-bold shrink-0">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white truncate">
                {displayName}
              </p>
              <p className="text-[10px] text-blue-300 truncate">Pro Plan</p>
            </div>
          </div>

          {/* Logout button */}
          <button
            onClick={() => signOut()}
            className="mt-1 w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium text-red-300 hover:bg-red-900/30 hover:text-red-200 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="bg-white border-b border-gray-100 px-6 py-3 flex items-center gap-4 shrink-0">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search cases, debtors..."
              className="w-full pl-9 pr-4 py-2 bg-[#F2F4F7] rounded-lg text-sm text-gray-700 placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-emerald-200 border border-transparent focus:border-emerald-300 transition-all"
            />
          </div>
          <button className="relative w-9 h-9 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors">
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
        <main className="flex-1 overflow-y-auto scrollbar-hide p-6">
          <ErrorBoundary context="DashboardShell">
            {children}
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
