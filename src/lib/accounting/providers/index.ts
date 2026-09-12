import "server-only";

import type { AccountingAdapter, AccountingProvider } from "../types";
import { quickBooksAdapter } from "./quickbooks";
import { xeroAdapter } from "./xero";

const adapters: Record<AccountingProvider, AccountingAdapter> = {
  xero: xeroAdapter,
  quickbooks: quickBooksAdapter,
};

export function getAccountingAdapter(provider: AccountingProvider) {
  return adapters[provider];
}
