import type {
  ActionCentrePayload,
  ActionCentreFilters,
  ActionCentreScope,
  ActionCentreTransition,
} from "@/lib/action-centre/types";
import { requestJson } from "@/lib/data/http-service";

export async function loadActionCentre(
  scope: ActionCentreScope = "active",
  filters: ActionCentreFilters = {},
  cursor?: string | null,
  pageSize = 25,
): Promise<ActionCentrePayload> {
  const params = new URLSearchParams({ scope, pageSize: String(pageSize) });
  if (filters.owner) params.set("owner", filters.owner);
  if (filters.queue) params.set("queue", filters.queue);
  if (filters.caseType) params.set("caseType", filters.caseType);
  if (filters.severity) params.set("severity", filters.severity);
  if (filters.due) params.set("due", filters.due);
  if (cursor) params.set("cursor", cursor);
  return requestJson<ActionCentrePayload>(
    `/api/action-centre?${params.toString()}`,
    { cache: "no-store" },
    "Unable to load Action Centre.",
  );
}

export async function transitionAction(
  actionId: string,
  action: ActionCentreTransition,
  snoozedUntil?: string,
) {
  await requestJson<{ updated?: boolean }>(`/api/action-centre/${encodeURIComponent(actionId)}`, {
    method: "PATCH",
    keepalive: true,
    body: JSON.stringify({ action, snoozedUntil }),
  }, "Unable to update Action Centre item.");
}
