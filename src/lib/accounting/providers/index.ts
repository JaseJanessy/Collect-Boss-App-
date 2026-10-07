import "server-only";

import type { AccountingAdapter, AccountingProvider } from "../types";
import { autoCountAdapter } from "./autocount";
import { bukkuAdapter } from "./bukku";
import { quickBooksAdapter } from "./quickbooks";
import { xeroAdapter } from "./xero";

const adapters: Record<AccountingProvider, AccountingAdapter> = {
  xero: xeroAdapter,
  quickbooks: quickBooksAdapter,
  bukku: bukkuAdapter,
  autocount: autoCountAdapter,
};

export function getAccountingAdapter(provider: AccountingProvider) {
  return adapters[provider];
}
