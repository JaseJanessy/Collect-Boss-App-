export type NavigationPermission =
  | "billing.manage"
  | "users.manage"
  | "receiving_accounts.manage"
  | "settings.sensitive.manage"
  | "case.read"
  | "case.manage"
  | "report.read";

export type NavigationIcon =
  | "dashboard"
  | "cases"
  | "payments"
  | "action-centre"
  | "reports"
  | "debtors"
  | "documents"
  | "statements"
  | "notifications"
  | "team"
  | "billing"
  | "integrations"
  | "settings"
  | "business-profile"
  | "payment-accounts"
  | "support"
  | "beta-guide";

export interface NavigationItem {
  id: string;
  label: string;
  href: string;
  icon: NavigationIcon;
  permission?: NavigationPermission;
  description?: string;
  group?: "Workspace" | "Account" | "Support";
}

export interface PrimaryNavigationItem extends NavigationItem {
  id: "dashboard" | "cases" | "payments" | "action-centre" | "reports";
  permission: "case.read" | "report.read";
  owns: readonly string[];
}

/**
 * The single product-level source of truth for primary navigation order,
 * labels, routes, icons, permissions and active-route ownership.
 */
export const primaryNavigation = [
  {
    id: "dashboard",
    label: "Dashboard",
    href: "/",
    icon: "dashboard",
    permission: "case.read",
    owns: ["/"],
  },
  {
    id: "cases",
    label: "Cases",
    href: "/cases",
    icon: "cases",
    permission: "case.read",
    owns: ["/cases", "/debtors", "/add", "/reminders", "/evidence", "/legal", "/documents"],
  },
  {
    id: "payments",
    label: "Payments",
    href: "/payments",
    icon: "payments",
    permission: "case.read",
    owns: ["/payments", "/pay"],
  },
  {
    id: "action-centre",
    label: "Action Centre",
    href: "/actions",
    icon: "action-centre",
    permission: "case.read",
    owns: ["/actions", "/operations", "/notifications"],
  },
  {
    id: "reports",
    label: "Reports",
    href: "/reports",
    icon: "reports",
    permission: "report.read",
    owns: ["/reports", "/statements"],
  },
] as const satisfies readonly PrimaryNavigationItem[];

/** Secondary destinations are reachable from the account/More surface. */
export const secondaryNavigation = [
  { id: "debtors", label: "Debtors", href: "/debtors", icon: "debtors", permission: "case.read", group: "Workspace", description: "Debtor profiles and accounts" },
  { id: "documents", label: "Documents", href: "/documents", icon: "documents", permission: "case.read", group: "Workspace", description: "Notices and case evidence exports" },
  { id: "statements", label: "Statements", href: "/statements", icon: "statements", permission: "report.read", group: "Workspace", description: "Account and recovery statements" },
  { id: "notifications", label: "Notifications", href: "/notifications", icon: "notifications", permission: "case.read", group: "Workspace", description: "Updates that need your attention" },
  { id: "business-profile", label: "Business Profile", href: "/onboarding/profile", icon: "business-profile", permission: "settings.sensitive.manage", group: "Account", description: "Business identity and contact details" },
  { id: "payment-accounts", label: "Payment Accounts", href: "/payments/account", icon: "payment-accounts", permission: "receiving_accounts.manage", group: "Account", description: "Bank account and DuitNow settings" },
  { id: "team", label: "Team", href: "/settings#team", icon: "team", permission: "users.manage", group: "Account", description: "Members, roles and permissions" },
  { id: "billing", label: "Billing", href: "/billing", icon: "billing", permission: "billing.manage", group: "Account", description: "Subscription and plan" },
  { id: "integrations", label: "Integrations", href: "/settings#integrations", icon: "integrations", permission: "settings.sensitive.manage", group: "Account", description: "Accounting and connected services" },
  { id: "settings", label: "Settings", href: "/settings", icon: "settings", permission: "case.read", group: "Account", description: "Workspace preferences" },
  { id: "support", label: "Help & Support", href: "/support", icon: "support", group: "Support", description: "FAQ and contact" },
] as const satisfies readonly NavigationItem[];

export const protectedPageRules = [
  { prefix: "/billing", permission: "billing.manage" },
  { prefix: "/payments/account", permission: "receiving_accounts.manage" },
  { prefix: "/operations", permission: "case.manage" },
  { prefix: "/reports", permission: "report.read" },
  { prefix: "/statements", permission: "report.read" },
] as const satisfies readonly { prefix: string; permission: NavigationPermission }[];

export function navigationItemIsVisible(
  item: NavigationItem,
  permissions: readonly string[],
): boolean {
  return !item.permission || permissions.includes(item.permission);
}

export function activePrimaryNavigation(pathname: string): PrimaryNavigationItem | undefined {
  return primaryNavigation.find((item) => item.owns.some((prefix) =>
    prefix === "/" ? pathname === "/" : pathname === prefix || pathname.startsWith(`${prefix}/`),
  ));
}

export function requiredPermissionForPath(pathname: string): NavigationPermission | undefined {
  return protectedPageRules.find(({ prefix }) => pathname === prefix || pathname.startsWith(`${prefix}/`))?.permission;
}
