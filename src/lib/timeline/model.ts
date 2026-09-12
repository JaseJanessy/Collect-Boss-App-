import type { Json } from "@/lib/supabase/types";

export type TimelineVisibility = "internal_only" | "customer_visible";
export type TimelineAudience = "staff" | "customer";
export type TimelineCategory =
  | "communication"
  | "payments"
  | "promises"
  | "documents"
  | "case_changes";
export type TimelineFilter = "all" | TimelineCategory;

export interface CaseTimelineEvent {
  id: string;
  type: string;
  category: TimelineCategory;
  occurred_at: string;
  actor: { type: string; id: string | null };
  channel: string | null;
  summary: string;
  amount_minor: string | null;
  source_record: { table: string; id: string };
  metadata: Json;
  visibility: TimelineVisibility;
}

export interface TimelineSourceEvent {
  sourceTable: string;
  sourceId: string;
  type: string;
  category: TimelineCategory;
  occurredAt: string;
  actorType?: string | null;
  actorId?: string | null;
  channel?: string | null;
  summary: string;
  amountMinor?: string | number | null;
  metadata?: Json;
  visibility: TimelineVisibility;
}

function safeMetadata(value: Json | undefined): Json {
  return value && typeof value === "object" ? value : {};
}

export function buildCaseTimeline(
  sourceEvents: TimelineSourceEvent[],
  audience: TimelineAudience,
): CaseTimelineEvent[] {
  const deduplicated = new Map<string, CaseTimelineEvent>();

  for (const source of sourceEvents) {
    if (audience === "customer" && source.visibility !== "customer_visible") continue;
    const id = `${source.sourceTable}:${source.sourceId}:${source.type}`;
    if (deduplicated.has(id)) continue;
    deduplicated.set(id, {
      id,
      type: source.type,
      category: source.category,
      occurred_at: source.occurredAt,
      actor: { type: source.actorType ?? "system", id: source.actorId ?? null },
      channel: source.channel ?? null,
      summary: source.summary,
      amount_minor: source.amountMinor == null ? null : String(source.amountMinor),
      source_record: { table: source.sourceTable, id: source.sourceId },
      metadata: safeMetadata(source.metadata),
      visibility: source.visibility,
    });
  }

  return [...deduplicated.values()].sort((a, b) =>
    b.occurred_at.localeCompare(a.occurred_at) || b.id.localeCompare(a.id));
}

export function filterCaseTimeline(events: CaseTimelineEvent[], filter: TimelineFilter) {
  return filter === "all" ? events : events.filter((event) => event.category === filter);
}
