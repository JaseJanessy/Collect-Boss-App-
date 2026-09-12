import "server-only";

import { isPocketOfferKey, POCKET_OFFERS, type PocketOfferKey } from "./pocket-policy";

const POCKET_PRICE_ENV_NAMES: Readonly<Record<PocketOfferKey, string>> = Object.freeze({
  pocket_monthly: "STRIPE_PRICE_POCKET_MONTHLY",
  pocket_annual: "STRIPE_PRICE_POCKET_ANNUAL",
  pocket_invoice_addon: "STRIPE_PRICE_POCKET_INVOICE_ADDON",
  pocket_extra_invoice_pack: "STRIPE_PRICE_POCKET_EXTRA_INVOICE_PACK",
});

export function configuredPocketPrices(): Record<PocketOfferKey, string> {
  return Object.fromEntries(
    Object.entries(POCKET_PRICE_ENV_NAMES).map(([offerKey, envName]) => [offerKey, process.env[envName]?.trim() ?? ""]),
  ) as Record<PocketOfferKey, string>;
}

export function getPocketPriceId(offerKey: string): string | null {
  if (!isPocketOfferKey(offerKey)) return null;
  const value = configuredPocketPrices()[offerKey];
  return value.startsWith("price_") ? value : null;
}

export function pocketOfferFromPriceId(priceId: string | null | undefined): PocketOfferKey | null {
  if (!priceId) return null;
  const match = Object.entries(configuredPocketPrices()).find(([, configured]) => configured !== "" && configured === priceId)?.[0];
  return match && isPocketOfferKey(match) ? match : null;
}

export function configuredPocketOffer(offerKey: string) {
  if (!isPocketOfferKey(offerKey)) return null;
  const priceId = getPocketPriceId(offerKey);
  return priceId ? { definition: POCKET_OFFERS[offerKey], priceId } : null;
}

export function assertCompletePocketPriceConfiguration() {
  const missing = (Object.keys(POCKET_OFFERS) as PocketOfferKey[]).filter((offerKey) => !getPocketPriceId(offerKey));
  if (missing.length) throw new Error(`Pocket Stripe prices are missing for: ${missing.join(", ")}.`);
}
