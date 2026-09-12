import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedBusiness } from "@/lib/debtors/server";
import { actionQueues, type ActionDueFilter, type ActionQueue } from "@/lib/action-centre/priority";
import type {
  ActionCentreFilters,
  ActionCentrePayload,
  ActionCentreScope,
  ActionCentreViewItem,
} from "@/lib/action-centre/types";
import type { ActionCentrePriority, ContactGuardEvaluation } from "@/lib/supabase/types";
import { loadContactGuardEvaluations } from "@/lib/communications/guard-server";

export const dynamic = "force-dynamic";

const responseHeaders = { "Cache-Control": "private, no-store" };
const scopes = new Set<ActionCentreScope>(["active", "history"]);
const priorities = new Set<ActionCentrePriority>(["critical", "high", "medium", "low"]);
const dueFilters = new Set<ActionDueFilter>(["overdue", "today", "next_7_days", "no_due_date"]);
const caseTypes = new Set(["standalone", "single_obligation", "multiple_obligations", "account_balance"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400, headers: responseHeaders });
}

function decodeCursor(value: string | null) {
  if (!value) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { offset?: unknown };
    if (!Number.isInteger(parsed.offset) || Number(parsed.offset) < 0 || Number(parsed.offset) > 1_000_000) return null;
    return Number(parsed.offset);
  } catch {
    return null;
  }
}

function encodeCursor(offset: number | null) {
  return offset === null ? null : Buffer.from(JSON.stringify({ offset })).toString("base64url");
}

function parseFilters(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const scope = (params.get("scope") ?? "active") as ActionCentreScope;
  const owner = params.get("owner") ?? undefined;
  const queue = params.get("queue") as ActionQueue | null;
  const caseType = params.get("caseType") ?? undefined;
  const severity = params.get("severity") as ActionCentrePriority | null;
  const due = params.get("due") as ActionDueFilter | null;
  const cursor = decodeCursor(params.get("cursor"));
  const pageSize = Number(params.get("pageSize") ?? 25);

  if (!scopes.has(scope)) return { error: "Invalid Action Centre scope." } as const;
  if (owner && owner !== "me" && owner !== "unassigned" && !UUID_PATTERN.test(owner)) return { error: "Invalid owner filter." } as const;
  if (queue && !actionQueues.includes(queue)) return { error: "Invalid queue filter." } as const;
  if (caseType && !caseTypes.has(caseType)) return { error: "Invalid case type filter." } as const;
  if (severity && !priorities.has(severity)) return { error: "Invalid severity filter." } as const;
  if (due && !dueFilters.has(due)) return { error: "Invalid due-date filter." } as const;
  if (cursor === null) return { error: "Invalid pagination cursor." } as const;
  if (!Number.isInteger(pageSize) || pageSize < 5 || pageSize > 50) return { error: "Page size must be between 5 and 50." } as const;

  return {
    scope,
    filters: { owner, queue: queue ?? undefined, caseType, severity: severity ?? undefined, due: due ?? undefined } satisfies ActionCentreFilters,
    offset: cursor,
    pageSize,
  } as const;
}

interface DashboardRpcPayload extends Omit<ActionCentrePayload, "page"> {
  page: { nextOffset: number | null; hasMore: boolean };
}

export async function GET(request: NextRequest) {
  const parsed = parseFilters(request);
  if ("error" in parsed) return badRequest(parsed.error ?? "Invalid Action Centre request.");

  const auth = await getAuthenticatedBusiness("case.read");
  if ("error" in auth) {
    const message = auth.error ?? "Action Centre is unavailable.";
    return NextResponse.json(
      { error: message },
      { status: message === "You must be signed in." ? 401 : 503, headers: responseHeaders },
    );
  }

  const { data, error } = await auth.client.rpc("action_centre_dashboard", {
    p_scope: parsed.scope,
    p_owner: parsed.filters.owner ?? null,
    p_queue: parsed.filters.queue ?? null,
    p_case_scope: parsed.filters.caseType ?? null,
    p_priority: parsed.filters.severity ?? null,
    p_due: parsed.filters.due ?? null,
    p_offset: parsed.offset,
    p_limit: parsed.pageSize,
  });
  if (error || !data) {
    const missingMigration = error?.code === "42883" || error?.message?.includes("action_centre_dashboard");
    return NextResponse.json({
      error: missingMigration
        ? "The action-priority database migration is required before this dashboard can load."
        : "Unable to load the action-priority dashboard.",
    }, { status: 503, headers: responseHeaders });
  }

  const payload = data as unknown as DashboardRpcPayload;
  const items = Array.isArray(payload.items) ? payload.items as ActionCentreViewItem[] : [];
  const caseIds = [...new Set(items.flatMap((item) => item.case_id ? [item.case_id] : []))];
  const guardrails = await loadContactGuardEvaluations(auth.client, caseIds, null);
  if (guardrails.error) {
    return NextResponse.json({ error: guardrails.error }, { status: 503, headers: responseHeaders });
  }

  const guardedItems = items.map((item) => {
    const contactRelated = ["follow_up.due", "promise.missed", "payment_plan.missed"].includes(item.type);
    const contactGuard = contactRelated && item.case_id
      ? guardrails.evaluations.get(item.case_id) ?? null
      : null;
    return {
      ...item,
      recommended_action: contactGuard?.warnings.length ? contactGuard.recommended_action : item.recommended_action,
      contact_guard: contactGuard as ContactGuardEvaluation | null,
    };
  });

  return NextResponse.json({
    ...payload,
    items: guardedItems,
    page: {
      hasMore: Boolean(payload.page?.hasMore),
      nextCursor: encodeCursor(payload.page?.nextOffset ?? null),
    },
  } satisfies ActionCentrePayload, { headers: responseHeaders });
}
