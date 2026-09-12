import "server-only";

import { createHash } from "node:crypto";
import type { AppSupabaseClient } from "@/lib/supabase/client";
import type {
  ContactFrequencyPolicy,
  ContactPreferenceRow,
  PocketReminderEventRow,
  PocketReminderPreferenceRow,
  PocketReminderScheduleRow,
} from "@/lib/supabase/types";
import { evaluateContactGuard } from "@/lib/communications/guardrails";
import { formatCurrencyMinor } from "@/lib/financial/money";
import { loadPocketCustomers, loadPocketDebts } from "./ledger-server";
import { workspaceLocalDate } from "./ledger";
import {
  buildPocketReminderCandidates,
  buildWhatsAppDeepLink,
  defaultPocketReminderToggles,
  normalizeReminderMessage,
  reminderGroupForEvent,
  reminderTemplateForEvent,
  renderPocketReminderTemplate,
  whatsappPhone,
  type PocketReminderEventType,
  type PocketReminderLanguage,
  type PocketReminderTemplateKey,
  type PocketReminderToggles,
} from "./reminders";

type PocketAccess = {
  service: AppSupabaseClient;
  businessId: string;
  user: { id: string };
  business: { timezone?: unknown; default_currency?: unknown; locale?: unknown; business_name?: unknown; legal_name?: unknown };
};

type ReminderDebt = Awaited<ReturnType<typeof loadPocketDebts>>[number];

export class PocketReminderError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message);
  }
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function preferenceToggles(row?: PocketReminderPreferenceRow): PocketReminderToggles {
  return row ? {
    enabled: row.enabled,
    dueSoon: row.due_soon_enabled,
    dueToday: row.due_today_enabled,
    overdue: row.overdue_enabled,
    stillOverdue: row.still_overdue_enabled,
    partialBalance: row.partial_balance_enabled,
  } : defaultPocketReminderToggles;
}

type ScheduledReminderEvent = PocketReminderEventType | "invoice_due";

function eventLabel(event: ScheduledReminderEvent) {
  if (event === "invoice_due") return "Invoice due today";
  if (event === "due_soon") return "Due tomorrow";
  if (event === "due_today") return "Due today";
  if (event === "overdue") return "Overdue";
  if (event === "still_overdue") return "Still overdue";
  return "Payment received · balance remains";
}

function notificationCopy(event: ScheduledReminderEvent, customer: string, remainingMinor: number, currency: string) {
  const amount = formatCurrencyMinor(remainingMinor, currency, { explicitCode: true });
  return {
    title: eventLabel(event),
    message: `${customer} has ${amount} remaining. Review before preparing any customer reminder.`,
    severity: event === "overdue" || event === "still_overdue" ? "high" as const : "medium" as const,
  };
}

function currentCardEvent(debt: ReminderDebt, today: string): PocketReminderEventType | null {
  if (!["active", "partially_paid", "overdue"].includes(debt.status) || debt.archivedAt || debt.remainingMinor <= 0) return null;
  if (debt.dueDate === today) return "due_today";
  if (debt.dueDate) {
    const tomorrow = new Date(`${today}T00:00:00.000Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    if (debt.dueDate === tomorrow.toISOString().slice(0, 10)) return "due_soon";
  }
  if (debt.daysOverdue > 0) return debt.daysOverdue >= 7 ? "still_overdue" : "overdue";
  return null;
}

export async function loadPocketReminderFeed(access: PocketAccess, now = new Date()) {
  const [debts, customersResult, preferencesResult, eventsResult, entitlementResult] = await Promise.all([
    loadPocketDebts(access),
    loadPocketCustomers(access, true),
    access.service.from("pocket_reminder_preferences").select("*").eq("business_id", access.businessId),
    access.service.from("pocket_reminder_events").select("*").eq("business_id", access.businessId).order("created_at", { ascending: false }).limit(100),
    access.service.rpc("pocket_get_entitlements", { p_business_id: access.businessId }),
  ]);
  if (preferencesResult.error || eventsResult.error || entitlementResult.error) throw new Error("Pocket reminders are temporarily unavailable.");
  const customers = new Map(customersResult.map((item) => [item.id, item]));
  const preferences = new Map(((preferencesResult.data ?? []) as PocketReminderPreferenceRow[]).map((item) => [item.obligation_id, item]));
  const events = (eventsResult.data ?? []) as PocketReminderEventRow[];
  const today = workspaceLocalDate(String(access.business.timezone ?? "UTC"), now);
  const debtCards = debts.flatMap((debt) => {
    const preference = preferences.get(debt.id);
    const paymentToday = Boolean(debt.lastPaymentAt && workspaceLocalDate(String(access.business.timezone ?? "UTC"), new Date(debt.lastPaymentAt)) === today);
    const eventType = currentCardEvent(debt, today)
      ?? (preference?.partial_balance_enabled && paymentToday && debt.status === "partially_paid" ? "partial_balance" : null);
    if (!eventType || preference?.enabled === false) return [];
    if (preference?.snoozed_until && preference.snoozed_until > now.toISOString()) return [];
    const customer = customers.get(debt.customerId);
    return [{
      id: `${debt.id}:${eventType}`,
      debtId: debt.id,
      customerId: debt.customerId,
      customerName: debt.customerName,
      phoneAvailable: Boolean(whatsappPhone(customer?.phone)),
      amountMinor: debt.remainingMinor,
      currency: debt.currency,
      dueDate: debt.dueDate,
      dueState: eventLabel(eventType),
      eventType,
      group: reminderGroupForEvent(eventType),
      template: reminderTemplateForEvent(eventType),
      language: preferredLanguage(customer?.preferredReminderLanguage),
      invoiceId: null,
    }];
  });
  const entitlement = entitlementResult.data as { addOns?: { simpleInvoice?: boolean }; capabilities?: Record<string, { enabled?: boolean }> } | null;
  const invoiceResult = entitlement?.addOns?.simpleInvoice && entitlement.capabilities?.["pocket.invoice.create"]?.enabled
    ? await access.service.from("pocket_simple_invoices").select("id,customer_id,invoice_number,due_date,total_minor,currency,status,obligation_id")
      .eq("business_id", access.businessId).eq("due_date", today).in("status", ["issued","partially_paid"])
    : { data: [], error: null };
  if (invoiceResult.error) throw new Error("Pocket invoice reminders are temporarily unavailable.");
  const invoiceCards = (invoiceResult.data ?? []).flatMap((invoice) => {
    const customer = customers.get(invoice.customer_id);
    if (!customer) return [];
    const linkedDebt = invoice.obligation_id ? debts.find((debt) => debt.id === invoice.obligation_id) : null;
    const amountMinor = linkedDebt?.remainingMinor ?? Number(invoice.total_minor);
    if (amountMinor <= 0) return [];
    return [{
      id: `invoice:${invoice.id}:due`, debtId: null, invoiceId: invoice.id, customerId: invoice.customer_id,
      customerName: customer.displayName, phoneAvailable: Boolean(whatsappPhone(customer.phone)), amountMinor,
      currency: invoice.currency, dueDate: invoice.due_date, dueState: `Invoice ${invoice.invoice_number} due today`,
      eventType: "invoice_due" as const, group: "today" as const, template: "due_today" as const,
      language: preferredLanguage(customer.preferredReminderLanguage),
    }];
  });
  const cards = [...debtCards, ...invoiceCards];
  const dueToday = cards.filter((item) => item.eventType === "due_today");
  return {
    today,
    summary: {
      dueTodayCustomerCount: new Set(dueToday.map((item) => item.customerId)).size,
      dueTodayTotalMinor: dueToday.reduce((sum, item) => sum + item.amountMinor, 0),
      currency: String(access.business.default_currency ?? "MYR"),
    },
    groups: {
      today: cards.filter((item) => item.group === "today"),
      overdue: cards.filter((item) => item.group === "overdue"),
      payments: cards.filter((item) => item.group === "payments"),
      system: [],
    },
    history: events.map((event) => ({
      id: event.id,
      debtId: event.obligation_id,
      customerId: event.customer_id,
      customerName: customers.get(event.customer_id)?.displayName ?? "Customer",
      amountMinor: event.remaining_minor,
      currency: event.currency,
      eventType: event.event_type,
      template: event.template_key,
      language: event.language,
      createdAt: event.created_at,
    })),
  };
}

function preferredLanguage(value?: string | null): PocketReminderLanguage {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "ms" || normalized === "malay" || normalized === "bm") return "ms";
  if (normalized === "zh" || normalized === "chinese" || normalized === "中文") return "zh";
  return "en";
}

async function loadReminderDebt(access: PocketAccess, debtId: string) {
  const [debt, customers] = await Promise.all([
    loadPocketDebts(access).then((items) => items.find((item) => item.id === debtId)),
    loadPocketCustomers(access, true),
  ]);
  if (!debt) throw new PocketReminderError("Debt not found.", "DEBT_NOT_FOUND", 404);
  if (!["active", "partially_paid", "overdue"].includes(debt.status) || debt.archivedAt || debt.remainingMinor <= 0) {
    throw new PocketReminderError("This debt no longer has a reminder-ready balance.", "DEBT_NOT_REMINDER_READY", 409);
  }
  const customer = customers.find((item) => item.id === debt.customerId);
  if (!customer || customer.archivedAt) throw new PocketReminderError("Customer not found.", "CUSTOMER_NOT_FOUND", 404);
  return { debt, customer };
}

async function contactEvaluation(access: PocketAccess, debt: ReminderDebt, now = new Date()) {
  const [preferenceResult, policyResult, eventsResult] = await Promise.all([
    access.service.from("contact_preferences").select("*").eq("business_id", access.businessId).eq("customer_id", debt.customerId).maybeSingle(),
    access.service.from("contact_frequency_policies").select("*").eq("business_id", access.businessId).maybeSingle(),
    access.service.from("pocket_reminder_events").select("created_at").eq("business_id", access.businessId).eq("customer_id", debt.customerId).eq("event_type", "opened_to_whatsapp").gte("created_at", new Date(now.getTime() - 30 * 86_400_000).toISOString()),
  ]);
  if (preferenceResult.error || policyResult.error || eventsResult.error) {
    throw new PocketReminderError("Contact preferences are temporarily unavailable.", "CONTACT_GUARD_UNAVAILABLE", 503);
  }
  const rows = (eventsResult.data ?? []) as Array<{ created_at: string }>;
  const since = (days: number) => now.getTime() - days * 86_400_000;
  const count = (days: number) => rows.filter((item) => Date.parse(item.created_at) >= since(days)).length;
  const policy = (policyResult.data as ContactFrequencyPolicy | null) ?? {
    max_attempts_24h: 2,
    max_attempts_7d: 5,
    max_attempts_30d: 12,
    frequency_mode: "warn",
    preference_mode: "require_override",
    bulk_mode: "exclude",
  };
  return evaluateContactGuard({
    case_id: debt.id,
    customer_id: debt.customerId,
    timezone: String(access.business.timezone ?? "UTC"),
    counts: { attempts_24h: count(1), attempts_7d: count(7), attempts_30d: count(30) },
    policy,
    preferences: preferenceResult.data as ContactPreferenceRow | null,
  }, "whatsapp", { now });
}

function businessName(access: PocketAccess) {
  return String(access.business.business_name ?? access.business.legal_name ?? "the business");
}

async function scheduleForDebt(access: PocketAccess, scheduleId: string | null | undefined, debtId: string) {
  if (!scheduleId) return null;
  const { data, error } = await access.service.from("pocket_reminder_schedules").select("*")
    .eq("id", scheduleId).eq("business_id", access.businessId).eq("obligation_id", debtId).maybeSingle();
  if (error || !data) throw new PocketReminderError("Reminder schedule not found.", "SCHEDULE_NOT_FOUND", 404);
  return data as PocketReminderScheduleRow;
}

async function recordEvent(access: PocketAccess, input: {
  debt: ReminderDebt; scheduleId?: string | null; eventType: "prepared" | "opened_to_whatsapp";
  template: PocketReminderTemplateKey; language: PocketReminderLanguage; message: string;
  defaultMessage: string; idempotencyKey: string; requestHash: string;
}) {
  const { data: existing, error: existingError } = await access.service.from("pocket_reminder_events").select("*")
    .eq("business_id", access.businessId).eq("idempotency_key", input.idempotencyKey).maybeSingle();
  if (existingError) throw new PocketReminderError("Reminder history is temporarily unavailable.", "REMINDER_HISTORY_UNAVAILABLE", 503);
  if (existing) {
    const metadata = existing.metadata as Record<string, unknown>;
    if (metadata.request_hash !== input.requestHash) throw new PocketReminderError("This reminder request key was already used for different content.", "IDEMPOTENCY_CONFLICT", 409);
    return existing as PocketReminderEventRow;
  }
  const { data, error } = await access.service.from("pocket_reminder_events").insert({
    business_id: access.businessId,
    obligation_id: input.debt.id,
    customer_id: input.debt.customerId,
    schedule_id: input.scheduleId ?? null,
    event_type: input.eventType,
    template_key: input.template,
    language: input.language,
    message_sha256: sha256(input.message),
    remaining_minor: input.debt.remainingMinor,
    currency: input.debt.currency,
    due_date: input.debt.dueDate,
    user_edited: input.message !== input.defaultMessage,
    created_by: access.user.id,
    idempotency_key: input.idempotencyKey,
    metadata: { request_hash: input.requestHash, delivery_claimed: false, read_claimed: false },
  }).select("*").single();
  if (error || !data) throw new PocketReminderError("Reminder history could not be recorded.", "REMINDER_HISTORY_UNAVAILABLE", 503);
  return data as PocketReminderEventRow;
}

export async function preparePocketReminder(access: PocketAccess, input: {
  debtId: string; scheduleId?: string | null; template: PocketReminderTemplateKey;
  language: PocketReminderLanguage; idempotencyKey: string;
}) {
  const [{ debt, customer }, schedule] = await Promise.all([
    loadReminderDebt(access, input.debtId),
    scheduleForDebt(access, input.scheduleId, input.debtId),
  ]);
  const message = renderPocketReminderTemplate(input.template, input.language, {
    customerName: customer.displayName,
    remainingMinor: debt.remainingMinor,
    currency: debt.currency,
    dueDate: debt.dueDate,
    businessName: businessName(access),
    locale: String(access.business.locale ?? "en-MY"),
  });
  const evaluation = await contactEvaluation(access, debt);
  const requestHash = sha256(JSON.stringify({ action: "prepare", ...input, message }));
  const event = await recordEvent(access, {
    debt, scheduleId: schedule?.id, eventType: "prepared", template: input.template,
    language: input.language, message, defaultMessage: message, idempotencyKey: input.idempotencyKey, requestHash,
  });
  return {
    preparedEventId: event.id,
    message,
    customerName: customer.displayName,
    phoneAvailable: Boolean(whatsappPhone(customer.phone)),
    warnings: evaluation.warnings,
    requiresConfirmation: evaluation.requires_override,
    recommendedAction: evaluation.recommended_action,
    deliveryStatus: "not_sent" as const,
  };
}

export async function openPocketWhatsApp(access: PocketAccess, input: {
  debtId: string; scheduleId?: string | null; template: PocketReminderTemplateKey;
  language: PocketReminderLanguage; editedMessage?: string | null;
  confirmGuardWarnings: boolean; idempotencyKey: string;
}) {
  const [{ debt, customer }, schedule] = await Promise.all([
    loadReminderDebt(access, input.debtId),
    scheduleForDebt(access, input.scheduleId, input.debtId),
  ]);
  const defaultMessage = renderPocketReminderTemplate(input.template, input.language, {
    customerName: customer.displayName,
    remainingMinor: debt.remainingMinor,
    currency: debt.currency,
    dueDate: debt.dueDate,
    businessName: businessName(access),
    locale: String(access.business.locale ?? "en-MY"),
  });
  const message = input.editedMessage == null ? defaultMessage : normalizeReminderMessage(input.editedMessage);
  if (!message) throw new PocketReminderError("Reminder message is required.", "INVALID_MESSAGE", 400);
  const evaluation = await contactEvaluation(access, debt);
  if (evaluation.requires_override && !input.confirmGuardWarnings) {
    throw new PocketReminderError("Review and confirm the documented contact warnings before opening WhatsApp.", "CONTACT_GUARD_CONFIRMATION_REQUIRED", 409);
  }
  const phone = whatsappPhone(customer.phone);
  if (!phone) throw new PocketReminderError("Add a valid international-format customer phone number before opening WhatsApp.", "INVALID_WHATSAPP_PHONE", 409);
  const deepLink = buildWhatsAppDeepLink(phone, message);
  const requestHash = sha256(JSON.stringify({ action: "open_whatsapp", ...input, message }));
  const event = await recordEvent(access, {
    debt, scheduleId: schedule?.id, eventType: "opened_to_whatsapp", template: input.template,
    language: input.language, message, defaultMessage, idempotencyKey: input.idempotencyKey, requestHash,
  });
  return {
    eventId: event.id,
    deepLink,
    warnings: evaluation.warnings,
    handoffStatus: "opened_to_whatsapp" as const,
    deliveryStatus: "unknown" as const,
    readStatus: "unknown" as const,
  };
}

export async function updatePocketReminderPreference(access: PocketAccess, input: {
  debtId: string; enabled?: boolean; pushEnabled?: boolean; partialBalanceEnabled?: boolean; snoozedUntil?: string | null;
}) {
  const { debt } = await loadReminderDebt(access, input.debtId);
  const { data: current, error: currentError } = await access.service.from("pocket_reminder_preferences").select("*")
    .eq("business_id", access.businessId).eq("obligation_id", debt.id).maybeSingle();
  if (currentError) throw new PocketReminderError("Reminder preferences are temporarily unavailable.", "REMINDER_PREFERENCES_UNAVAILABLE", 503);
  const previous = current as PocketReminderPreferenceRow | null;
  const { data, error } = await access.service.from("pocket_reminder_preferences").upsert({
    id: previous?.id,
    business_id: access.businessId,
    obligation_id: debt.id,
    customer_id: debt.customerId,
    enabled: input.enabled ?? previous?.enabled ?? true,
    due_soon_enabled: previous?.due_soon_enabled ?? true,
    due_today_enabled: previous?.due_today_enabled ?? true,
    overdue_enabled: previous?.overdue_enabled ?? true,
    still_overdue_enabled: previous?.still_overdue_enabled ?? true,
    partial_balance_enabled: input.partialBalanceEnabled ?? previous?.partial_balance_enabled ?? false,
    push_enabled: input.pushEnabled ?? previous?.push_enabled ?? true,
    snoozed_until: input.snoozedUntil === undefined ? previous?.snoozed_until ?? null : input.snoozedUntil,
    updated_by: access.user.id,
  }, { onConflict: "business_id,obligation_id" }).select("*").single();
  if (error || !data) throw new PocketReminderError("Reminder preferences could not be updated.", "REMINDER_PREFERENCES_UNAVAILABLE", 503);
  return data as PocketReminderPreferenceRow;
}

export async function syncPocketReminderSchedules(service: AppSupabaseClient, now = new Date()) {
  const states = await service.from("workspace_product_states").select("business_id,lifecycle_state")
    .eq("product_type", "pocket").eq("lifecycle_state", "active");
  if (states.error) throw new Error("Unable to load active Pocket workspaces.");
  const businessIds = (states.data ?? []).map((item) => item.business_id);
  if (!businessIds.length) return { workspaces: 0, projected: 0, cancelled: 0, notified: 0 };
  const invoiceBusinessIds: string[] = [];
  for (const businessId of businessIds) {
    const entitlement = await service.rpc("pocket_get_entitlements", { p_business_id: businessId });
    const view = entitlement.data as { addOns?: { simpleInvoice?: boolean }; capabilities?: Record<string, { enabled?: boolean }> } | null;
    if (!entitlement.error && view?.addOns?.simpleInvoice && view.capabilities?.["pocket.invoice.create"]?.enabled) invoiceBusinessIds.push(businessId);
  }
  const [businessesResult, debtsResult, customersResult, preferencesResult, invoicesResult] = await Promise.all([
    service.from("businesses").select("id,business_name,timezone,locale").in("id", businessIds),
    service.from("obligations").select("id,business_id,customer_id,status,archived_at,outstanding_minor,currency,pocket_due_date,updated_at")
      .in("business_id", businessIds).eq("origin_product_type", "pocket"),
    service.from("debtors").select("id,business_id,individual_name,business_name,phone,archived_at").in("business_id", businessIds),
    service.from("pocket_reminder_preferences").select("*").in("business_id", businessIds),
    invoiceBusinessIds.length ? service.from("pocket_simple_invoices")
      .select("id,business_id,customer_id,invoice_number,status,due_date,total_minor,currency,updated_at,obligation_id")
      .in("business_id", invoiceBusinessIds).in("status", ["issued","partially_paid"]) : { data: [], error: null },
  ]);
  if (businessesResult.error || debtsResult.error || customersResult.error || preferencesResult.error || invoicesResult.error) throw new Error("Unable to load Pocket reminder sources.");
  const businesses = new Map((businessesResult.data ?? []).map((item) => [item.id, item]));
  const customers = new Map((customersResult.data ?? []).map((item) => [`${item.business_id}:${item.id}`, item]));
  const preferences = new Map(((preferencesResult.data ?? []) as PocketReminderPreferenceRow[]).map((item) => [`${item.business_id}:${item.obligation_id}`, item]));
  const debtRows = debtsResult.data ?? [];
  const obligationIds = debtRows.map((item) => item.id);
  const recentStart = new Date(now.getTime() - 3 * 86_400_000).toISOString();
  const allocationsResult = obligationIds.length ? await service.from("payment_allocations")
    .select("id,business_id,obligation_id,event_type,reverses_allocation_id,created_at")
    .in("obligation_id", obligationIds).gte("created_at", recentStart) : { data: [], error: null };
  if (allocationsResult.error) throw new Error("Unable to load recent Pocket payments for reminders.");
  const allocations = allocationsResult.data ?? [];
  const reversed = new Set(allocations.filter((item) => item.event_type === "reversal" && item.reverses_allocation_id).map((item) => item.reverses_allocation_id));
  const expectedRows: Array<Omit<PocketReminderScheduleRow, "id" | "created_at" | "updated_at" | "notification_id" | "notified_at">> = [];
  for (const debt of debtRows) {
    const business = businesses.get(debt.business_id);
    const customer = customers.get(`${debt.business_id}:${debt.customer_id}`);
    if (!business || !customer || customer.archived_at) continue;
    const preference = preferences.get(`${debt.business_id}:${debt.id}`);
    const timezone = String(business.timezone ?? "UTC");
    const partialDates = allocations
      .filter((item) => item.obligation_id === debt.id && item.event_type === "allocation" && !reversed.has(item.id))
      .map((item) => workspaceLocalDate(timezone, new Date(item.created_at)));
    const candidates = buildPocketReminderCandidates({
      debtId: debt.id,
      dueDate: debt.pocket_due_date,
      status: debt.status,
      archivedAt: debt.archived_at,
      remainingMinor: Number(debt.outstanding_minor),
      currency: debt.currency,
      updatedAt: debt.updated_at,
      partialPaymentLocalDates: partialDates,
    }, preferenceToggles(preference));
    for (const candidate of candidates) {
      const snoozed = Boolean(preference?.snoozed_until && preference.snoozed_until > now.toISOString());
      expectedRows.push({
        business_id: debt.business_id,
        obligation_id: debt.id,
        invoice_id: null,
        customer_id: debt.customer_id,
        event_type: candidate.eventType,
        notification_group: candidate.group,
        scheduled_local_date: candidate.scheduledLocalDate,
        event_timezone: timezone,
        source_key: candidate.sourceKey,
        source_fingerprint: sha256(JSON.stringify({ debt: debt.id, due: debt.pocket_due_date, balance: debt.outstanding_minor, status: debt.status, contact: customer.phone, updated: debt.updated_at, candidate })),
        remaining_minor: Number(debt.outstanding_minor),
        currency: debt.currency,
        status: snoozed ? "snoozed" : "pending",
        snoozed_until: snoozed ? preference?.snoozed_until ?? null : null,
        cancellation_reason: null,
      });
    }
  }
  for (const invoice of invoicesResult.data ?? []) {
    const business = businesses.get(invoice.business_id);
    const customer = customers.get(`${invoice.business_id}:${invoice.customer_id}`);
    if (!business || !customer || customer.archived_at || !invoice.due_date) continue;
    const linkedDebt = invoice.obligation_id ? debtRows.find((debt) => debt.id === invoice.obligation_id) : null;
    const remainingMinor = linkedDebt ? Number(linkedDebt.outstanding_minor) : Number(invoice.total_minor);
    if (remainingMinor <= 0) continue;
    expectedRows.push({
      business_id: invoice.business_id, obligation_id: null, invoice_id: invoice.id, customer_id: invoice.customer_id,
      event_type: "invoice_due", notification_group: "today", scheduled_local_date: invoice.due_date,
      event_timezone: String(business.timezone ?? "UTC"), source_key: `invoice:${invoice.id}:due:${invoice.due_date}`,
      source_fingerprint: sha256(JSON.stringify({ invoice: invoice.id, due: invoice.due_date, balance: remainingMinor, status: invoice.status, updated: invoice.updated_at })),
      remaining_minor: remainingMinor, currency: invoice.currency, status: "pending", snoozed_until: null, cancellation_reason: null,
    });
  }
  const existingResult = await service.from("pocket_reminder_schedules").select("*").in("business_id", businessIds);
  if (existingResult.error) throw new Error("Unable to load existing Pocket reminder schedules.");
  const existing = (existingResult.data ?? []) as PocketReminderScheduleRow[];
  const expiredSnoozeKeys = new Set(existing.filter((item) => item.status === "snoozed" && Boolean(item.snoozed_until && item.snoozed_until <= now.toISOString()))
    .map((item) => `${item.business_id}:${item.source_key}`));
  const expectedKeys = new Set(expectedRows.map((item) => `${item.business_id}:${item.source_key}`));
  const staleIds = existing.filter((item) => ["pending", "snoozed"].includes(item.status) && !expectedKeys.has(`${item.business_id}:${item.source_key}`)).map((item) => item.id);
  let cancelled = 0;
  if (staleIds.length) {
    const result = await service.from("pocket_reminder_schedules").update({ status: "cancelled", snoozed_until: null, cancellation_reason: "source_no_longer_eligible" }).in("id", staleIds).select("id");
    if (result.error) throw new Error("Unable to cancel stale Pocket reminders.");
    cancelled = result.data?.length ?? 0;
  }
  const notifiedKeys = new Set(existing.filter((item) => item.status === "notified").map((item) => `${item.business_id}:${item.source_key}`));
  const upsertRows = expectedRows.filter((item) => !notifiedKeys.has(`${item.business_id}:${item.source_key}`));
  let projected: PocketReminderScheduleRow[] = [];
  if (upsertRows.length) {
    const result = await service.from("pocket_reminder_schedules").upsert(upsertRows, { onConflict: "business_id,source_key" }).select("*");
    if (result.error) throw new Error("Unable to project Pocket reminder schedules.");
    projected = (result.data ?? []) as PocketReminderScheduleRow[];
  }
  let notified = 0;
  for (const schedule of projected) {
    const business = businesses.get(schedule.business_id);
    const customer = customers.get(`${schedule.business_id}:${schedule.customer_id}`);
    const preference = schedule.obligation_id ? preferences.get(`${schedule.business_id}:${schedule.obligation_id}`) : undefined;
    if (!business || !customer) continue;
    const today = workspaceLocalDate(String(business.timezone ?? "UTC"), now);
    const snoozeExpired = expiredSnoozeKeys.has(`${schedule.business_id}:${schedule.source_key}`);
    if (!(schedule.status === "pending" && schedule.scheduled_local_date === today) && !snoozeExpired) continue;
    const customerName = String(customer.individual_name ?? customer.business_name ?? "Customer");
    const copy = notificationCopy(schedule.event_type, customerName, schedule.remaining_minor, schedule.currency);
    const dedupeKey = `pocket-reminder:${schedule.source_key}`;
    const inserted = await service.from("notifications").upsert({
      business_id: schedule.business_id,
      user_id: null,
      case_id: null,
      customer_id: schedule.customer_id,
      type: `POCKET_${schedule.event_type.toUpperCase()}`,
      event_type: `POCKET_${schedule.event_type.toUpperCase()}`,
      title: copy.title,
      message: copy.message,
      severity: copy.severity,
      action_url: schedule.invoice_id ? `/pocket/invoices/${schedule.invoice_id}` : `/pocket/reminders/${schedule.id}`,
      entity_type: "pocket_reminder_schedule",
      entity_id: schedule.id,
      dedupe_key: dedupeKey,
      domain_event_id: null,
      push_enabled: preference?.push_enabled ?? true,
    }, { onConflict: "business_id,dedupe_key", ignoreDuplicates: true }).select("id").maybeSingle();
    if (inserted.error) throw new Error("Unable to create Pocket owner notification.");
    let notificationId = inserted.data?.id;
    if (!notificationId) {
      const lookup = await service.from("notifications").select("id").eq("business_id", schedule.business_id).eq("dedupe_key", dedupeKey).maybeSingle();
      if (lookup.error || !lookup.data) throw new Error("Unable to resolve deduplicated Pocket notification.");
      notificationId = lookup.data.id;
    }
    const updated = await service.from("pocket_reminder_schedules").update({
      status: "notified", snoozed_until: null, notification_id: notificationId,
      notified_at: now.toISOString(), cancellation_reason: null,
    }).eq("id", schedule.id).eq("business_id", schedule.business_id);
    if (updated.error) throw new Error("Unable to complete Pocket reminder notification state.");
    notified += inserted.data ? 1 : 0;
  }
  return { workspaces: businessIds.length, projected: projected.length, cancelled, notified };
}
