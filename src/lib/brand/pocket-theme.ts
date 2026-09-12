import type { CSSProperties } from "react";

import { brandTokens } from "../../../shared/brand-tokens.ts";

type PocketCssProperties = CSSProperties & Record<`--pocket-${string}`, string>;

/** Pocket-only aliases derived from the authoritative cross-product source. */
export const pocketCssVariables: PocketCssProperties = {
  "--pocket-brand-navy": brandTokens.brand.navy,
  "--pocket-brand-green": brandTokens.brand.green,
  "--pocket-canvas": brandTokens.pocket.canvas,
  "--pocket-surface": brandTokens.pocket.surface,
  "--pocket-surface-muted": brandTokens.pocket.surfaceMuted,
  "--pocket-ink": brandTokens.pocket.ink,
  "--pocket-muted": brandTokens.pocket.muted,
  "--pocket-line": brandTokens.pocket.line,
  "--pocket-navy-raised": brandTokens.pocket.navyRaised,
  "--pocket-selected-surface": brandTokens.pocket.selectedSurface,
  "--pocket-focus": brandTokens.pocket.focus,
  "--pocket-action-primary": brandTokens.pocket.action.primary,
  "--pocket-action-primary-hover": brandTokens.pocket.action.primaryHover,
  "--pocket-action-primary-pressed": brandTokens.pocket.action.primaryPressed,
  "--pocket-action-add-debt": brandTokens.pocket.action.addDebt,
  "--pocket-action-add-debt-surface": brandTokens.pocket.action.addDebtSurface,
  "--pocket-action-record-payment": brandTokens.pocket.action.recordPayment,
  "--pocket-action-record-payment-surface": brandTokens.pocket.action.recordPaymentSurface,
  "--pocket-action-scan-receipt": brandTokens.pocket.action.scanReceipt,
  "--pocket-action-scan-receipt-surface": brandTokens.pocket.action.scanReceiptSurface,
  "--pocket-action-who-owes-me": brandTokens.pocket.action.whoOwesMe,
  "--pocket-action-who-owes-me-surface": brandTokens.pocket.action.whoOwesMeSurface,
  "--pocket-action-overdue": brandTokens.pocket.action.overdue,
  "--pocket-action-overdue-surface": brandTokens.pocket.action.overdueSurface,
};
