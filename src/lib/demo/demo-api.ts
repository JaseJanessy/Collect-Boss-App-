/**
 * Local demo responses for development mock mode only.
 *
 * Built from the same sample cases as the Cases list so dashboard totals,
 * priorities and case rows agree. Nothing here runs when Supabase is
 * configured; see `DemoApiProvider`.
 */
import type { ActionCentrePayload, ActionCentreViewItem } from "@/lib/action-centre/types";
import type { ActionQueue } from "@/lib/action-centre/priority";
import { mockCases, type DebtorCase } from "@/lib/mock-data";
import { calculateReportMetrics, type ReportCaseInput, type ReportEventInput } from "@/lib/reports/metrics";

export const DEMO_READ_ONLY_MESSAGE = "This is a demo workspace, so changes aren't saved. Sign up to use your own data.";

const DAY_MS = 86_400_000;
const DEMO_BUSINESS_ID = "demo-business";
const DEMO_OWNER = { id: "mock-user-001", label: "You" };

function toMinor(value: number) {
  return Math.round(value * 100);
}

function isoDateDaysAgo(days: number, now: Date) {
  return new Date(now.getTime() - days * DAY_MS).toISOString().slice(0, 10);
}

/** Sample due dates are re-based on today so the demo never looks stale. */
function demoDueDate(item: DebtorCase, now: Date) {
  return isoDateDaysAgo(item.status === "Paid" ? 20 : item.daysOverdue, now);
}

function reportStatus(item: DebtorCase) {
  if (item.status === "Paid") return "closed";
  if (item.status === "Payment Promise") return "promise_to_pay";
  if (item.status === "Partial Paid") return "partially_paid";
  if (item.status === "Formal Demand Ready") return "formal_demand";
  return "overdue";
}

export function demoReportCases(now = new Date()): ReportCaseInput[] {
  return mockCases.map((item) => {
    const contractual = toMinor(item.originalAmount);
    const paid = toMinor(item.amountPaid);
    return {
      id: item.id,
      debtorName: item.debtorName,
      invoiceNo: item.invoiceNo,
      dueDate: demoDueDate(item, now),
      status: reportStatus(item),
      archivedAt: null,
      currency: "MYR",
      originalPrincipalMinor: contractual,
      contractualDueMinor: contractual,
      approvedPaymentMinor: paid,
      outstandingMinor: Math.max(contractual - paid, 0),
      createdAt: new Date(now.getTime() - (item.daysOverdue + 30) * DAY_MS).toISOString(),
      closedAt: item.status === "Paid" ? new Date(now.getTime() - 3 * DAY_MS).toISOString() : null,
      closureReason: item.status === "Paid" ? "paid_in_full" : null,
      assignedTo: DEMO_OWNER.id,
    };
  });
}

function demoPaymentEvents(now: Date): ReportEventInput[] {
  return mockCases
    .filter((item) => item.amountPaid > 0)
    .map((item, index) => ({
      caseId: item.id,
      type: "payment_approved" as const,
      amountMinor: toMinor(item.amountPaid),
      createdAt: new Date(now.getTime() - (index + 2) * DAY_MS).toISOString(),
      currency: "MYR",
    }));
}

export function demoDashboardSummary(now = new Date()) {
  return {
    metrics: calculateReportMetrics(demoReportCases(now), demoPaymentEvents(now), {
      now,
      currentUserId: DEMO_OWNER.id,
    }),
  };
}

const ACTION_BY_STATUS: Partial<Record<DebtorCase["status"], {
  queue: ActionQueue;
  type: string;
  title: (item: DebtorCase) => string;
  recommended: string;
}>> = {
  "Formal Demand Ready": {
    queue: "follow_ups",
    type: "formal_demand_ready",
    title: (item) => `Send the formal payment notice to ${item.debtorName}`,
    recommended: "Review the draft notice and send it.",
  },
  Overdue: {
    queue: "follow_ups",
    type: "overdue_follow_up",
    title: (item) => `Remind ${item.debtorName} about the overdue invoice`,
    recommended: "Send a polite WhatsApp reminder.",
  },
  "Action Needed": {
    queue: "follow_ups",
    type: "follow_up_due",
    title: (item) => `Follow up with ${item.debtorName}`,
    recommended: "Call or message the customer today.",
  },
  "Payment Promise": {
    queue: "promises",
    type: "promise_due",
    title: (item) => `Check ${item.debtorName}'s promised payment`,
    recommended: "Confirm the payment arrived as promised.",
  },
  "Partial Paid": {
    queue: "payment_plans",
    type: "balance_remaining",
    title: (item) => `Collect the remaining balance from ${item.debtorName}`,
    recommended: "Ask for the next instalment.",
  },
};

function priorityFor(item: DebtorCase): ActionCentreViewItem["priority"] {
  if (item.status === "Formal Demand Ready" || item.daysOverdue >= 30) return "critical";
  if (item.daysOverdue >= 14) return "high";
  if (item.daysOverdue >= 7) return "medium";
  return "low";
}

const PRIORITY_ORDER: Record<ActionCentreViewItem["priority"], number> = { critical: 0, high: 1, medium: 2, low: 3 };

export function demoActionCentre(url: URL, now = new Date()): ActionCentrePayload {
  const pageSize = Math.max(1, Math.min(Number(url.searchParams.get("pageSize")) || 25, 100));
  const history = url.searchParams.get("scope") === "history";
  const all: ActionCentreViewItem[] = history ? [] : mockCases.flatMap((item) => {
    const rule = ACTION_BY_STATUS[item.status];
    if (!rule) return [];
    const outstanding = toMinor(Math.max(item.amountDue - item.amountPaid, 0));
    return [{
      id: `demo-action-${item.id}`,
      business_id: DEMO_BUSINESS_ID,
      case_id: item.id,
      customer_id: null,
      assignee_id: DEMO_OWNER.id,
      type: rule.type,
      title: rule.title(item),
      description: item.notes ?? `${item.debtorName} has an open balance.`,
      href: `/cases/${item.id}`,
      entity_type: "case",
      entity_id: item.id,
      status: "open" as const,
      reason: `${item.daysOverdue} days overdue`,
      amount_minor: outstanding,
      currency: "MYR",
      priority: priorityFor(item),
      due_at: new Date(now.getTime() + (item.daysOverdue >= 14 ? 0 : 2) * DAY_MS).toISOString(),
      recommended_action: rule.recommended,
      source_event_id: null,
      completed_at: null,
      snoozed_until: null,
      dedupe_key: `demo:${item.id}`,
      created_at: new Date(now.getTime() - item.daysOverdue * DAY_MS).toISOString(),
      customer_name: item.debtorName,
      outstanding_minor: outstanding,
      owner_name: DEMO_OWNER.label,
      age_seconds: item.daysOverdue * 86_400,
      queue: rule.queue,
      case_type: "collection",
      contact_guard: null,
    }];
  }).sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || b.amount_minor - a.amount_minor);

  const items = all.slice(0, pageSize);
  const amountMinor = all.reduce((sum, item) => sum + item.amount_minor, 0);
  const byPriority: ActionCentrePayload["summary"]["byPriority"] = {};
  const byQueue: ActionCentrePayload["summary"]["byQueue"] = {};
  for (const item of all) {
    byPriority[item.priority] = (byPriority[item.priority] ?? 0) + 1;
    byQueue[item.queue] = (byQueue[item.queue] ?? 0) + 1;
  }
  return {
    items,
    summary: {
      actionCount: all.length,
      amountMinor,
      actionableCaseCount: new Set(all.map((item) => item.case_id)).size,
      totalsByCurrency: all.length ? [{ currency: "MYR", amountMinor }] : [],
      byPriority,
      byQueue,
    },
    filters: { owners: [DEMO_OWNER], queues: [...new Set(all.map((item) => item.queue))], caseTypes: ["collection"] },
    page: { nextCursor: null, hasMore: all.length > items.length },
    permissions: { canFilterTeam: false },
  };
}

/**
 * Returns a demo body for a known read endpoint, `undefined` to let the
 * request continue unchanged, or a read-only refusal for demo writes.
 */
export function demoApiResponse(input: string, method = "GET", now = new Date()): { status: number; body: unknown } | undefined {
  const url = new URL(input, "http://demo.local");
  if (!url.pathname.startsWith("/api/")) return undefined;
  const verb = method.toUpperCase();
  if (verb !== "GET" && verb !== "HEAD") {
    if (url.pathname === "/api/feedback") return undefined;
    return { status: 409, body: { error: DEMO_READ_ONLY_MESSAGE, code: "DEMO_READ_ONLY" } };
  }
  if (/^\/api\/debtors\/[^/]+\/tax-details$/.test(url.pathname)) return { status: 200, body: { details: null } };
  switch (url.pathname) {
    case "/api/dashboard/summary":
      return { status: 200, body: demoDashboardSummary(now) };
    case "/api/action-centre":
      return { status: 200, body: demoActionCentre(url, now) };
    case "/api/notifications":
      return { status: 200, body: { notifications: [], unreadCount: 0 } };
    case "/api/operations/assignees":
      return { status: 200, body: { assignees: [{ id: DEMO_OWNER.id, label: "Amin Razali", role: "owner" }] } };
    case "/api/payment-submissions":
      return { status: 200, body: { submissions: [] } };
    case "/api/einvoice/profile":
      return { status: 200, body: { available: true, environment: "preprod", profile: null } };
    case "/api/einvoice/documents":
      return { status: 200, body: { documents: [] } };
    case "/api/payments/online":
      return { status: 200, body: { available: true, state: "not_connected" } };
    case "/api/recurring-charges":
      return { status: 200, body: { charges: [] } };
    case "/api/whatsapp-reminders":
      return {
        status: 200,
        body: {
          available: true,
          paidPlan: true,
          policy: { enabled: true, dayOffsets: [-3, 0, 3, 7, 14], language: "en", consentAttestedAt: now.toISOString() },
          recent: mockCases.slice(0, 3).map((item, index) => ({
            id: `demo-wa-${index}`,
            template_kind: "overdue",
            status: index === 0 ? "read" : index === 1 ? "delivered" : "skipped",
            skip_reason: index === 2 ? "customer_opted_out" : null,
            error_message: null,
            local_send_date: isoDateDaysAgo(index, now),
            customerName: item.debtorName,
            amount: `MYR ${item.amountDue.toLocaleString("en-MY", { minimumFractionDigits: 2 })}`,
          })),
        },
      };
    default:
      return undefined;
  }
}
