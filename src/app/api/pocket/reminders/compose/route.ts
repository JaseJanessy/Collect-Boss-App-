import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { appendSensitiveAudit } from "@/lib/auth/tenant-access";
import { authorizePocketCapability, requirePocketBillingAccess } from "@/lib/billing/pocket-entitlements";
import { openPocketWhatsApp, PocketReminderError, preparePocketReminder } from "@/lib/pocket/reminders-server";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie, Authorization" };
const base = {
  debtId: z.string().uuid().optional(),
  scheduleId: z.string().uuid().nullable().optional(),
  template: z.enum(["gentle", "due_today", "overdue", "partial_balance"]),
  language: z.enum(["en", "ms", "zh"]),
};
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("prepare"), ...base }).strict(),
  z.object({
    action: z.literal("open_whatsapp"), ...base,
    editedMessage: z.string().max(1_200).nullable().optional(),
    confirmGuardWarnings: z.boolean().default(false),
  }).strict(),
]).refine((value) => Boolean(value.debtId || value.scheduleId), { message: "A debt or schedule is required." });

function failure(error: unknown) {
  if (error instanceof PocketReminderError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers });
  return NextResponse.json({ error: "The reminder could not be prepared." }, { status: 503, headers });
}

export async function POST(request: NextRequest) {
  const access = await requirePocketBillingAccess("case.manage");
  if ("code" in access) return NextResponse.json({ error: access.error, code: access.code }, { status: access.status, headers });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the reminder details and try again." }, { status: 400, headers });
  const idempotency = z.string().uuid().safeParse(request.headers.get("idempotency-key"));
  if (!idempotency.success) return NextResponse.json({ error: "A valid Idempotency-Key header is required." }, { status: 400, headers });
  const authorization = await authorizePocketCapability({ access, capability: "pocket.reminder.manage" });
  if ("error" in authorization) return NextResponse.json({ error: authorization.error, code: authorization.code }, { status: authorization.status, headers });
  try {
    let debtId = parsed.data.debtId;
    if (!debtId && parsed.data.scheduleId) {
      const schedule = await access.service.from("pocket_reminder_schedules").select("obligation_id")
        .eq("id", parsed.data.scheduleId).eq("business_id", access.businessId).maybeSingle();
      if (schedule.error || !schedule.data) throw new PocketReminderError("Reminder schedule not found.", "SCHEDULE_NOT_FOUND", 404);
      debtId = schedule.data.obligation_id;
    }
    if (!debtId) throw new PocketReminderError("Debt not found.", "DEBT_NOT_FOUND", 404);
    if (parsed.data.action === "prepare") {
      const result = await preparePocketReminder(access, { ...parsed.data, debtId, idempotencyKey: idempotency.data });
      await appendSensitiveAudit({ access, request, action: "pocket.reminder.prepared", entityType: "obligation", entityId: debtId, metadata: { prepared_event_id: result.preparedEventId, template: parsed.data.template, language: parsed.data.language, delivery_claimed: false } });
      return NextResponse.json(result, { headers });
    }
    const result = await openPocketWhatsApp(access, { ...parsed.data, debtId, idempotencyKey: idempotency.data });
    await appendSensitiveAudit({ access, request, action: "pocket.reminder.opened_to_whatsapp", entityType: "obligation", entityId: debtId, metadata: { event_id: result.eventId, template: parsed.data.template, language: parsed.data.language, delivery_status: "unknown", read_status: "unknown" } });
    return NextResponse.json(result, { headers });
  } catch (error) {
    return failure(error);
  }
}
