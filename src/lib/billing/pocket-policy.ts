export type PocketOfferKey =
  | "pocket_monthly"
  | "pocket_annual"
  | "pocket_invoice_addon"
  | "pocket_extra_invoice_pack";

export type PocketCapabilityKey =
  | "pocket.data.read"
  | "pocket.data.export"
  | "pocket.customer.manage"
  | "pocket.debt.manage"
  | "pocket.payment.record"
  | "pocket.receipt.process"
  | "pocket.invoice.create"
  | "pocket.reminder.manage"
  | "pocket.report.basic"
  | "pocket.workspace.user";

export type PocketLifecycleState =
  | "trialing"
  | "active"
  | "past_due"
  | "payment_retry"
  | "cancelled_at_period_end"
  | "cancelled"
  | "grace_read_only"
  | "suspended";

export type PocketBillingErrorCode =
  | "LIMIT_REACHED"
  | "ADD_ON_REQUIRED"
  | "SUBSCRIPTION_PAST_DUE"
  | "READ_ONLY_MODE"
  | "PLAN_NOT_AUTHORISED";

export interface PocketOfferDefinition {
  key: PocketOfferKey;
  name: string;
  amountMinor: number;
  currency: "MYR";
  kind: "base" | "addon" | "cycle_pack";
  checkoutMode: "subscription" | "payment";
  interval: "month" | "year" | "cycle";
  recurring: boolean;
}

export const POCKET_LIMITS = Object.freeze({
  activeUsers: 1,
  activeDebts: 100,
  receiptProcessingPerCycle: 100,
  simpleInvoicesPerCycle: 30,
  extraInvoicesPerCycle: 30,
  maximumInvoicesPerCycle: 60,
  paymentRetryGraceDays: 7,
});

export const POCKET_OFFERS: Readonly<Record<PocketOfferKey, PocketOfferDefinition>> = Object.freeze({
  pocket_monthly: {
    key: "pocket_monthly", name: "Pocket Monthly", amountMinor: 990, currency: "MYR",
    kind: "base", checkoutMode: "subscription", interval: "month", recurring: true,
  },
  pocket_annual: {
    key: "pocket_annual", name: "Pocket Annual", amountMinor: 9_900, currency: "MYR",
    kind: "base", checkoutMode: "subscription", interval: "year", recurring: true,
  },
  pocket_invoice_addon: {
    key: "pocket_invoice_addon", name: "Simple Invoice Add-on", amountMinor: 1_000, currency: "MYR",
    kind: "addon", checkoutMode: "subscription", interval: "month", recurring: true,
  },
  pocket_extra_invoice_pack: {
    key: "pocket_extra_invoice_pack", name: "Extra Invoice Pack", amountMinor: 1_000, currency: "MYR",
    kind: "cycle_pack", checkoutMode: "payment", interval: "cycle", recurring: false,
  },
});

export const POCKET_BASE_CAPABILITIES: readonly PocketCapabilityKey[] = Object.freeze([
  "pocket.data.read", "pocket.data.export", "pocket.customer.manage", "pocket.debt.manage",
  "pocket.payment.record", "pocket.receipt.process", "pocket.reminder.manage", "pocket.report.basic",
  "pocket.workspace.user",
]);

export const POCKET_READ_ONLY_CAPABILITIES: readonly PocketCapabilityKey[] = Object.freeze([
  "pocket.data.read", "pocket.data.export",
]);

export function isPocketOfferKey(value: string): value is PocketOfferKey {
  return Object.hasOwn(POCKET_OFFERS, value);
}

export function offerGrantsSameBaseCapabilities(offerKey: PocketOfferKey): boolean {
  return offerKey === "pocket_monthly" || offerKey === "pocket_annual";
}

export function invoiceLimit(invoiceAddonActive: boolean, extraPackActive: boolean): number {
  if (!invoiceAddonActive) return 0;
  return Math.min(
    POCKET_LIMITS.maximumInvoicesPerCycle,
    POCKET_LIMITS.simpleInvoicesPerCycle + (extraPackActive ? POCKET_LIMITS.extraInvoicesPerCycle : 0),
  );
}

export function lifecycleAllowsWrite(state: PocketLifecycleState): boolean {
  return state === "trialing" || state === "active" || state === "cancelled_at_period_end" || state === "payment_retry";
}

export function lifecycleAllowsRead(state: PocketLifecycleState): boolean {
  void state;
  return true;
}

export function stablePocketBillingError(message: string | null | undefined): PocketBillingErrorCode | null {
  if (!message) return null;
  return (["LIMIT_REACHED", "ADD_ON_REQUIRED", "SUBSCRIPTION_PAST_DUE", "READ_ONLY_MODE", "PLAN_NOT_AUTHORISED"] as const)
    .find((code) => message.includes(code)) ?? null;
}
