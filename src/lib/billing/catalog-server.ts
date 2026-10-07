import "server-only";

import { PLAN_ORDER } from "./plans";
import type { PlanSlug } from "./types";

export type CheckoutPlanSlug = Exclude<PlanSlug, "free">;

const CHECKOUT_PLAN_SLUGS = PLAN_ORDER.filter((slug): slug is CheckoutPlanSlug => slug !== "free");
const PRICE_ENV_NAMES: Record<CheckoutPlanSlug, string> = {
  starter: "STRIPE_PRICE_STARTER",
  boss: "STRIPE_PRICE_BOSS",
  pro: "STRIPE_PRICE_PRO",
};

export function configuredPlanPrices() {
  return Object.fromEntries(CHECKOUT_PLAN_SLUGS.map((slug) => [slug, process.env[PRICE_ENV_NAMES[slug]]?.trim() ?? ""])) as Record<CheckoutPlanSlug, string>;
}

export function getPriceId(planSlug: string): string | null {
  if (!CHECKOUT_PLAN_SLUGS.includes(planSlug as CheckoutPlanSlug)) return null;
  const value = configuredPlanPrices()[planSlug as CheckoutPlanSlug];
  return value.startsWith("price_") ? value : null;
}

export function isCheckoutSlug(value: string): value is CheckoutPlanSlug {
  return CHECKOUT_PLAN_SLUGS.includes(value as CheckoutPlanSlug);
}

export function planSlugFromPriceId(priceId: string | null | undefined, metadataSlug?: string | null): PlanSlug {
  if (priceId) {
    const prices = configuredPlanPrices();
    const match = CHECKOUT_PLAN_SLUGS.find((slug) => prices[slug] === priceId);
    if (match) return match;
  }
  return metadataSlug && PLAN_ORDER.includes(metadataSlug as PlanSlug) ? metadataSlug as PlanSlug : "free";
}

export function isConfiguredPlanPriceId(priceId: string | null | undefined) {
  return Boolean(priceId) && Object.values(configuredPlanPrices()).some((configured) => configured !== "" && configured === priceId);
}

export function assertCompletePriceConfiguration() {
  const missing = CHECKOUT_PLAN_SLUGS.filter((slug) => !getPriceId(slug));
  if (missing.length) throw new Error(`Stripe prices are missing for: ${missing.join(", ")}.`);
}

/** RM10 per user per month add-on for paid plans. Optional: seats are hidden until configured. */
export const EXTRA_SEAT_MAX = 100;

export function extraSeatPriceId(): string | null {
  const value = process.env.STRIPE_PRICE_EXTRA_SEAT?.trim() ?? "";
  return value.startsWith("price_") ? value : null;
}

export function isExtraSeatPriceId(priceId: string | null | undefined): boolean {
  const configured = extraSeatPriceId();
  return Boolean(priceId) && configured !== null && priceId === configured;
}
