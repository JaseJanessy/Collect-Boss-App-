export type PocketNavigationIcon =
  | "home"
  | "customers"
  | "add"
  | "activity"
  | "more";

export type PocketPrimaryNavigationId =
  | "home"
  | "customers"
  | "add"
  | "activity"
  | "more";

export interface PocketPrimaryNavigationItem {
  id: PocketPrimaryNavigationId;
  label: string;
  href: string;
  icon: PocketNavigationIcon;
  owns: readonly string[];
}

export interface PocketDestination {
  id: string;
  label: string;
  href: string;
  description: string;
  owner: PocketPrimaryNavigationId;
}

export const pocketPrimaryNavigation = [
  { id: "home", label: "Home", href: "/pocket", icon: "home", owns: ["/pocket", "/pocket/debts", "/pocket/due-today"] },
  { id: "customers", label: "Customers", href: "/pocket/customers", icon: "customers", owns: ["/pocket/customers"] },
  { id: "add", label: "Add", href: "/pocket/add", icon: "add", owns: ["/pocket/add", "/pocket/debts/new", "/pocket/payments", "/pocket/receipts/scan", "/pocket/invoices/new"] },
  { id: "activity", label: "Activity", href: "/pocket/activity", icon: "activity", owns: ["/pocket/activity", "/pocket/reminders", "/pocket/receipts", "/pocket/reports"] },
  { id: "more", label: "More", href: "/pocket/more", icon: "more", owns: ["/pocket/more", "/pocket/settings", "/pocket/billing", "/pocket/invoices", "/pocket/upgrade"] },
] as const satisfies readonly PocketPrimaryNavigationItem[];

export const pocketDestinations = [
  { id: "add-debt", label: "Add Debt", href: "/pocket/debts/new", description: "Create a debt for a customer.", owner: "add" },
  { id: "record-payment", label: "Record Payment", href: "/pocket/payments/new", description: "Record money received from a customer.", owner: "add" },
  { id: "scan-receipt", label: "Scan Receipt", href: "/pocket/receipts/scan", description: "Upload a receipt for review.", owner: "add" },
  { id: "who-owes-me", label: "Who Owes Me", href: "/pocket/debts", description: "See customers with a remaining balance.", owner: "home" },
  { id: "due-today", label: "Due Today", href: "/pocket/due-today", description: "See debts due today.", owner: "home" },
  { id: "customer-profiles", label: "Customer Profiles", href: "/pocket/customers", description: "Keep customer contact details together.", owner: "customers" },
  { id: "reminders", label: "Reminders", href: "/pocket/reminders", description: "Review reminder activity.", owner: "activity" },
  { id: "receipts", label: "Receipts", href: "/pocket/receipts", description: "Review saved receipts.", owner: "activity" },
  { id: "basic-reports", label: "Basic Reports", href: "/pocket/reports", description: "Open a simple business summary.", owner: "activity" },
  { id: "settings", label: "Settings", href: "/pocket/settings", description: "Manage Pocket preferences.", owner: "more" },
  { id: "plan-limits", label: "Plan & Limits", href: "/pocket/billing", description: "Review billing, add-ons, and current-cycle limits.", owner: "more" },
  { id: "simple-invoices", label: "Simple Invoices", href: "/pocket/invoices", description: "Review invoice drafts and issued PDFs.", owner: "more" },
  { id: "upgrade-solo", label: "Upgrade to Solo", href: "/pocket/upgrade", description: "Keep your data and move into the full Solo workspace.", owner: "more" },
] as const satisfies readonly PocketDestination[];

function pathMatches(pathname: string, prefix: string): boolean {
  return prefix === "/pocket"
    ? pathname === prefix
    : pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function activePocketNavigation(pathname: string): PocketPrimaryNavigationItem | undefined {
  return pocketPrimaryNavigation
    .flatMap((item) => item.owns.map((prefix) => ({ item, prefix })))
    .filter(({ prefix }) => pathMatches(pathname, prefix))
    .sort((left, right) => right.prefix.length - left.prefix.length)[0]?.item;
}

export function pocketDestinationForPath(pathname: string): PocketDestination | undefined {
  return pocketDestinations.find((item) => item.href === pathname);
}

export function pocketPathFromUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const pathname = url.pathname.startsWith("/pocket")
      ? url.pathname
      : url.hostname === "pocket"
        ? `/pocket${url.pathname === "/" ? "" : url.pathname}`
        : null;
    if (!pathname) return null;
    if (pocketPrimaryNavigation.some((item) => item.href === pathname)) return pathname;
    return pocketDestinationForPath(pathname)?.href ?? null;
  } catch {
    return null;
  }
}
