import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { appendSensitiveAudit } from "@/lib/auth/tenant-access";
import { authorizePocketCapability, requirePocketBillingAccess } from "@/lib/billing/pocket-entitlements";
import {
  loadPocketReminderFeed,
  PocketReminderError,
  updatePocketReminderPreference,
} from "@/lib/pocket/reminders-server";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie, Authorization" };
const preferenceSchema = z.object({
  debtId: z.string().uuid(),
  action: z.enum(["enable", "disable", "snooze", "clear_snooze", "set_push", "set_partial_balance"]),
  hours: z.union([z.literal(1), z.literal(24), z.literal(168)]).optional(),
  value: z.boolean().optional(),
}).strict().superRefine((value, context) => {
  if (value.action === "snooze" && value.hours === undefined) context.addIssue({ code: "custom", path: ["hours"], message: "Choose a snooze duration." });
  if (["set_push", "set_partial_balance"].includes(value.action) && value.value === undefined) context.addIssue({ code: "custom", path: ["value"], message: "Choose an enabled state." });
});

function failure(error: unknown) {
  if (error instanceof PocketReminderError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers });
  return NextResponse.json({ error: "Pocket reminders are temporarily unavailable." }, { status: 503, headers });
}

export async function GET() {
  const access = await requirePocketBillingAccess("case.read");
  if ("code" in access) return NextResponse.json({ error: access.error, code: access.code }, { status: access.status, headers });
  try {
    return NextResponse.json(await loadPocketReminderFeed(access), { headers });
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: NextRequest) {
  const access = await requirePocketBillingAccess("case.manage");
  if ("code" in access) return NextResponse.json({ error: access.error, code: access.code }, { status: access.status, headers });
  const parsed = preferenceSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the reminder preference and try again." }, { status: 400, headers });
  const authorization = await authorizePocketCapability({ access, capability: "pocket.reminder.manage" });
  if ("error" in authorization) return NextResponse.json({ error: authorization.error, code: authorization.code }, { status: authorization.status, headers });
  const snoozedUntil = parsed.data.action === "snooze"
    ? new Date(Date.now() + parsed.data.hours! * 60 * 60 * 1_000).toISOString()
    : parsed.data.action === "clear_snooze" ? null : undefined;
  try {
    const preference = await updatePocketReminderPreference(access, {
      debtId: parsed.data.debtId,
      enabled: parsed.data.action === "enable" ? true : parsed.data.action === "disable" ? false : undefined,
      pushEnabled: parsed.data.action === "set_push" ? parsed.data.value : undefined,
      partialBalanceEnabled: parsed.data.action === "set_partial_balance" ? parsed.data.value : undefined,
      snoozedUntil,
    });
    await appendSensitiveAudit({
      access,
      request,
      action: `pocket.reminder.${parsed.data.action}`,
      entityType: "obligation",
      entityId: parsed.data.debtId,
      after: { enabled: preference.enabled, pushEnabled: preference.push_enabled, partialBalanceEnabled: preference.partial_balance_enabled, snoozedUntil: preference.snoozed_until },
    });
    return NextResponse.json({ preference }, { headers });
  } catch (error) {
    return failure(error);
  }
}
