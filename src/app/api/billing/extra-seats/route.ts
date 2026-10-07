/**
 * POST /api/billing/extra-seats  { quantity: number }
 *
 * Sets the number of paid extra team seats (RM10 per user per month) on the
 * business's active Main subscription. Stripe prorates the change; the
 * Stripe webhook then synchronises entitlements, so this route never writes
 * entitlement state itself.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireTenantPermission } from "@/lib/auth/tenant-access";
import { EXTRA_SEAT_MAX, extraSeatPriceId } from "@/lib/billing/catalog-server";
import { PLANS } from "@/lib/billing/plans";
import { loadTeamSeatUsage } from "@/lib/billing/team-seats";
import type { PlanSlug } from "@/lib/billing/types";
import { getStripeServer, isStripeConfigured } from "@/lib/stripe/server";

export const dynamic = "force-dynamic";

const err = (message: string, status: number, code?: string) =>
  NextResponse.json({ error: message, ...(code ? { code } : {}) }, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: NextRequest) {
  const stripe = isStripeConfigured ? getStripeServer() : null;
  const seatPriceId = extraSeatPriceId();
  if (!stripe || !seatPriceId) return err("Extra team members are not available yet.", 503, "EXTRA_SEATS_UNAVAILABLE");

  const access = await requireTenantPermission("billing.manage");
  if ("error" in access) return err(access.error ?? "Billing access denied.", access.status ?? 403);

  const requestKey = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!/^[A-Za-z0-9._:-]{8,200}$/.test(requestKey)) return err("A valid Idempotency-Key header is required.", 400);

  const body = await request.json().catch(() => null) as { quantity?: unknown } | null;
  const quantity = Number(body?.quantity);
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > EXTRA_SEAT_MAX) {
    return err(`Choose between 0 and ${EXTRA_SEAT_MAX} extra team members.`, 400);
  }

  const { data: subscription, error: subscriptionError } = await access.service.from("subscriptions")
    .select("stripe_subscription_id,status,plan_slug").eq("business_id", access.businessId).maybeSingle();
  if (subscriptionError) return err("We couldn't load your subscription. Please try again.", 503);
  const row = subscription as { stripe_subscription_id: string | null; status: string; plan_slug: string } | null;
  if (!row?.stripe_subscription_id || !["active", "trialing"].includes(row.status) || row.plan_slug === "free") {
    return err("Extra team members are available on paid plans. Upgrade first.", 409, "PAID_PLAN_REQUIRED");
  }

  const plan = PLANS[row.plan_slug as PlanSlug];
  const seats = await loadTeamSeatUsage(access.service, access.businessId);
  if (!plan || !seats) return err("We couldn't check your team size right now. Please try again.", 503);
  if (plan.team_member_limit !== -1 && seats.used > plan.team_member_limit + quantity) {
    const remove = seats.used - (plan.team_member_limit + quantity);
    return err(
      `Your team has ${seats.used} people. Remove ${remove} ${remove === 1 ? "person" : "people"} before reducing seats.`,
      409,
      "SEATS_IN_USE",
    );
  }

  try {
    const stripeSubscription = await stripe.subscriptions.retrieve(row.stripe_subscription_id);
    const seatItem = stripeSubscription.items.data.find((item) => item.price?.id === seatPriceId);
    const options = { idempotencyKey: `extra-seats:${access.businessId}:${quantity}:${requestKey}` };
    if (seatItem && quantity === 0) {
      await stripe.subscriptionItems.del(seatItem.id, { proration_behavior: "create_prorations" }, options);
    } else if (seatItem) {
      await stripe.subscriptionItems.update(seatItem.id, { quantity, proration_behavior: "create_prorations" }, options);
    } else if (quantity > 0) {
      await stripe.subscriptionItems.create({
        subscription: stripeSubscription.id,
        price: seatPriceId,
        quantity,
        proration_behavior: "create_prorations",
      }, options);
    }
  } catch {
    console.error("[billing] extra_seat_update_failed", { businessId: access.businessId });
    return err("We couldn't update your team seats. Please try again.", 502);
  }

  return NextResponse.json(
    { extraSeats: quantity, teamLimit: plan.team_member_limit === -1 ? -1 : plan.team_member_limit + quantity, syncing: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}
