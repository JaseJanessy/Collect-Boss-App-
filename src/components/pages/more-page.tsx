"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import {
  User,
  Building2,
  CreditCard,
  Settings,
  FileText,
  HelpCircle,
  LogOut,
  ChevronRight,
  Shield,
  Rocket,
  Zap,
} from "lucide-react";

interface MenuRow {
  icon:    React.ReactNode;
  label:   string;
  sub?:    string;
  href?:   string;
  action?: () => void;
  danger?: boolean;
}

export function MorePage() {
  const { user, signOut } = useAuth();

  const initials = user?.name
    ? user.name.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)
    : user?.email?.slice(0, 2).toUpperCase() ?? "CB";

  const menuGroups: Array<{ title: string; items: MenuRow[] }> = [
    {
      title: "Account",
      items: [
        {
          icon:  <Building2 className="w-4 h-4 text-[#009966]" />,
          label: "Business Profile",
          sub:   "Edit your business details",
          href:  "/onboarding/profile",
        },
        {
          icon:  <CreditCard className="w-4 h-4 text-blue-500" />,
          label: "Payment Accounts",
          sub:   "Bank account and DuitNow",
          href:  "/payments/account",
        },
        {
          icon:  <Shield className="w-4 h-4 text-purple-500" />,
          label: "Payment Security",
          sub:   "Default lock mode settings",
          href:  "/payments/requests",
        },
        {
          icon:  <Zap className="w-4 h-4 text-amber-500" />,
          label: "Billing & Plan",
          sub:   "Manage your subscription",
          href:  "/billing",
        },
      ],
    },
    {
      title: "App",
      items: [
        {
          icon:  <Settings className="w-4 h-4 text-gray-500" />,
          label: "Settings",
          href:  "/settings",
        },
        {
          icon:  <FileText className="w-4 h-4 text-amber-500" />,
          label: "Documents & Legal",
          href:  "/documents",
        },
        {
          icon:  <HelpCircle className="w-4 h-4 text-gray-400" />,
          label: "Help & Support",
          sub:   "FAQ and contact",
          href:  "#",
        },
        {
          icon:  <Rocket className="w-4 h-4 text-[#009966]" />,
          label: "Beta Welcome Guide",
          sub:   "Getting started & checklist",
          href:  "/beta-welcome",
        },
      ],
    },
    {
      title: "",
      items: [
        {
          icon:   <LogOut className="w-4 h-4 text-red-500" />,
          label:  "Sign Out",
          action: signOut,
          danger: true,
        },
      ],
    },
  ];

  return (
    <div className="flex flex-col pb-6">
      {/* User header */}
      <div className="bg-[#0D1B3D] px-4 pt-5 pb-6">
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-[#009966] flex items-center justify-center text-white text-lg font-black">
            {initials}
          </div>
          <div>
            <p className="text-base font-black text-white">
              {user?.name ?? "Demo User"}
            </p>
            <p className="text-xs text-blue-200 mt-0.5">
              {user?.email ?? "demo@collectboss.my"}
            </p>
            <span className="inline-block mt-1 text-[10px] font-bold text-emerald-300 bg-emerald-900/40 px-2 py-0.5 rounded-full">
              Pro Plan
            </span>
          </div>
        </div>
      </div>

      {/* Menu groups */}
      <div className="px-4 pt-4 flex flex-col gap-4">
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
                      {item.icon}
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
                    <button key={item.label} onClick={item.action} className="w-full text-left">
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

        {/* Legal notice */}
        <p className="text-[11px] text-gray-400 text-center leading-relaxed px-4">
          CollectBoss does not provide legal advice.
          All debt recovery actions are your responsibility.
        </p>
      </div>
    </div>
  );
}
