"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import {
  LogOut,
  ChevronRight,
} from "lucide-react";
import { navigationItemIsVisible, secondaryNavigation, type NavigationIcon as NavigationIconName } from "@collectboss/navigation";
import { NavigationIcon } from "@/components/navigation/navigation-icon";
import { workspacePlanLabel } from "@/lib/workspace/presentation";

interface MenuRow {
  icon:    NavigationIconName | "sign-out";
  label:   string;
  sub?:    string;
  href?:   string;
  action?: () => void;
  danger?: boolean;
}

export function MorePage() {
  const { user, signOut, permissions, workspace, signingOut, signOutError, isConfigured } = useAuth();

  const initials = user?.name
    ? user.name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)
    : user?.email?.slice(0, 2).toUpperCase() ?? "CB";

  const visibleSecondary = secondaryNavigation.filter((item) => navigationItemIsVisible(item, permissions));
  const menuGroups: Array<{ title: string; items: MenuRow[] }> = [
    ...(["Workspace", "Account", "Support"] as const).map((title) => ({
      title,
      items: visibleSecondary
        .filter((item) => item.group === title)
        .map((item) => ({
          icon: item.icon,
          label: item.label,
          sub: item.description,
          href: item.href,
        })),
    })).filter((group) => group.items.length > 0),
    {
      title: "",
      items: [
        {
          icon:   "sign-out",
          label:  "Sign Out",
          action: signOut,
          danger: true,
        },
      ],
    },
  ];

  return (
    <div className="mx-auto flex max-w-5xl flex-col pb-6">
      {/* User header */}
      <div className="border-b border-[var(--cb-border)] bg-white px-5 py-6 md:rounded-xl md:border">
        <h1 className="cb-page-title mb-5">More</h1>
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-[#009966] flex items-center justify-center text-white text-lg font-black">
            {initials}
          </div>
          <div>
            <p className="text-base font-semibold text-slate-900">
              {user?.name ?? "Your account"}
            </p>
            <p className="text-sm text-slate-500 mt-0.5">
              {user?.email ?? "Account details unavailable"}
            </p>
            <span className="inline-block mt-2 text-xs font-medium text-emerald-800 bg-emerald-50 px-2 py-1 rounded-md">
              {isConfigured ? workspacePlanLabel(workspace?.plan.slug) : "Development preview"}
            </span>
          </div>
        </div>
      </div>

      {/* Menu groups */}
      <div className="grid items-start gap-5 px-4 pt-6 md:grid-cols-2 md:px-0">
        {menuGroups.map((group, gi) => (
          <div key={gi}>
            {group.title && (
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2 ml-1">
                {group.title}
              </p>
            )}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              {group.items.map((item, ii) => {
                const isLast = ii === group.items.length - 1;
                const inner = (
                  <div
                    className={cn(
                      "flex items-center gap-3 px-4 py-3.5",
                      !isLast && "border-b border-gray-50",
                      item.danger
                        ? "hover:bg-red-50"
                        : "hover:bg-gray-50",
                      "transition-colors cursor-pointer"
                    )}
                  >
                    <div className="w-8 h-8 bg-gray-50 rounded-xl flex items-center justify-center shrink-0">
                      {item.icon === "sign-out"
                        ? <LogOut className="w-4 h-4 text-red-500" />
                        : <NavigationIcon name={item.icon} className="w-4 h-4 text-blue-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p
                        className={cn(
                          "text-sm font-semibold",
                          item.danger ? "text-red-600" : "text-gray-900"
                        )}
                      >
                        {item.label}
                      </p>
                      {item.sub && (
                        <p className="text-[11px] text-gray-400 mt-0.5">{item.sub}</p>
                      )}
                    </div>
                    {!item.action && (
                      <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
                    )}
                  </div>
                );

                if (item.action) {
                  return (
                    <button key={item.label} disabled={signingOut} onClick={item.action} className="w-full text-left">
                      {inner}
                    </button>
                  );
                }
                return (
                  <Link key={item.label} href={item.href ?? "#"}>
                    {inner}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}

        {signOutError && <p role="alert" className="text-sm text-red-700 md:col-span-2">{signOutError}</p>}
        {/* Legal notice */}
        <p className="text-xs text-gray-500 text-center leading-relaxed px-4 md:col-span-2">
          CollectBoss does not provide legal advice.
          All debt recovery actions are your responsibility.
        </p>
      </div>
    </div>
  );
}
