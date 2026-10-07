import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/cron/authorization";
import { getServiceClient } from "@/lib/supabase/service-client";
import type { Json } from "@/lib/supabase/types";
import { processScheduledEmailFollowups } from "@/lib/email/service";
import { checkMobilePushReceipts, dispatchMobilePushNotifications } from "@/lib/notifications/push";
import { syncPocketReminderSchedules } from "@/lib/pocket/reminders-server";
import { processWhatsAppReminders } from "@/lib/whatsapp/worker";
import { refreshPendingEinvoices } from "@/lib/einvoice/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

async function run(request: NextRequest) {
  const authorization = authorizeCronRequest(request);
  if (authorization === "not_configured") {
    return NextResponse.json({ error: "Domain-event scheduler is not configured." }, { status: 503 });
  }
  if (authorization !== "authorized") {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const service = await getServiceClient();
  if (!service) {
    return NextResponse.json({ error: "Supabase service access is unavailable." }, { status: 503 });
  }

  // Create this period's repeating charges first so they are detected below.
  const { data: recurringData, error: recurringError } = await service.rpc("recurring_charges_generate", { p_today: null });
  if (recurringError) {
    return NextResponse.json({ error: "Repeating charge scheduler failed." }, { status: 500 });
  }

  const { data: promiseData, error: promiseError } = await service.rpc(
    "payment_promises_run_scheduler",
    { p_now: null },
  );
  if (promiseError) {
    return NextResponse.json({ error: "Payment-promise scheduler failed." }, { status: 500 });
  }

  const { data, error } = await service.rpc("domain_events_detect", { p_now: null });
  if (error) {
    return NextResponse.json({ error: "Domain-event scheduler failed." }, { status: 500 });
  }

  let emailData: Awaited<ReturnType<typeof processScheduledEmailFollowups>>;
  try {
    emailData = await processScheduledEmailFollowups(service, 50);
  } catch {
    return NextResponse.json({ error: "Scheduled email follow-up processing failed." }, { status: 500 });
  }

  const { data: notificationData, error: notificationError } = await service.rpc(
    "notifications_consume_domain_events",
    { p_limit: 500 },
  );
  if (notificationError) {
    return NextResponse.json(
      { error: "Domain events were detected, but notification projection failed." },
      { status: 500 },
    );
  }

  let pocketReminders: Awaited<ReturnType<typeof syncPocketReminderSchedules>>;
  try {
    pocketReminders = await syncPocketReminderSchedules(service);
  } catch {
    return NextResponse.json(
      { error: "Main notifications were processed, but Pocket reminder projection failed." },
      { status: 500 },
    );
  }

  const { data: actionData, error: actionError } = await service.rpc(
    "action_centre_consume_domain_events",
    { p_limit: 500 },
  );
  if (actionError) {
    return NextResponse.json(
      { error: "Domain events and notifications were processed, but Action Centre projection failed." },
      { status: 500 },
    );
  }

  const { data: priorityData, error: priorityError } = await service.rpc(
    "action_centre_refresh_priority_gaps",
    { p_limit: 500 },
  );
  if (priorityError) {
    return NextResponse.json(
      { error: "Action Centre events were processed, but operational priority projection failed." },
      { status: 500 },
    );
  }

  let pushReceipts: Awaited<ReturnType<typeof checkMobilePushReceipts>>;
  let mobilePush: Awaited<ReturnType<typeof dispatchMobilePushNotifications>>;
  try {
    pushReceipts = await checkMobilePushReceipts(service);
    mobilePush = await dispatchMobilePushNotifications(service);
  } catch (pushError) {
    console.error("[cron] mobile_push_failed", { message: pushError instanceof Error ? pushError.message.slice(0, 200) : "unknown" });
    return NextResponse.json({ error: "Mobile push processing failed." }, { status: 502 });
  }

  let whatsapp: Awaited<ReturnType<typeof processWhatsAppReminders>>;
  try {
    whatsapp = await processWhatsAppReminders(service);
  } catch {
    return NextResponse.json({ error: "Earlier steps completed, but WhatsApp reminders failed." }, { status: 502 });
  }

  // e-Invoice validation results are informational; a failure here never blocks the run.
  const einvoices = await refreshPendingEinvoices(service).catch(() => ({ checked: 0, updated: 0, failed: true }));

  return NextResponse.json(
    {
      processed: data as Json,
      recurringCharges: recurringData as Json,
      promises: promiseData as Json,
      notifications: notificationData as Json,
      pocketReminders,
      actions: actionData as Json,
      priorities: priorityData as Json,
      emails: emailData,
      mobilePush,
      pushReceipts,
      whatsapp,
      einvoices,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

// Vercel Cron invokes GET. POST remains available for an authenticated manual
// retry without introducing a second execution path.
export async function GET(request: NextRequest) {
  return run(request);
}

export async function POST(request: NextRequest) {
  return run(request);
}
