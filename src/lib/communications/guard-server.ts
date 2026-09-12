import "server-only";

import type { AppSupabaseClient } from "@/lib/supabase/client";
import type { CommunicationChannel, ContactGuardEvaluation, Json } from "@/lib/supabase/types";
import { evaluateContactGuard, type ContactGuardContext } from "./guardrails";

export async function loadContactGuardEvaluations(
  client: AppSupabaseClient,
  caseIds: string[],
  channel: CommunicationChannel | null,
  options: { bulk?: boolean; overrideProvided?: boolean } = {},
): Promise<{ evaluations: Map<string, ContactGuardEvaluation>; error: string | null }> {
  if (caseIds.length === 0) return { evaluations: new Map(), error: null };
  const loaded = await loadContactGuardContexts(client, caseIds);
  if (loaded.error) return { evaluations: new Map(), error: loaded.error };
  const evaluations = new Map<string, ContactGuardEvaluation>();
  for (const [caseId, context] of loaded.contexts) {
    evaluations.set(caseId, evaluateContactGuard(context, channel, options));
  }
  return { evaluations, error: null };
}

export async function loadContactGuardContexts(
  client: AppSupabaseClient,
  caseIds: string[],
): Promise<{ contexts: Map<string, ContactGuardContext>; error: string | null }> {
  if (caseIds.length === 0) return { contexts: new Map(), error: null };
  const uniqueCaseIds = [...new Set(caseIds)];
  const { data, error } = await client.rpc("contact_guard_context", { p_case_ids: uniqueCaseIds });
  if (error || !data) {
    return { contexts: new Map(), error: "Unable to evaluate contact frequency and preferences." };
  }
  const payload = data as unknown as Record<string, ContactGuardContext>;
  const customerIds = [...new Set(Object.values(payload)
    .map((context) => context.customer_id)
    .filter((id): id is string => Boolean(id)))];
  const preferenceMap = new Map<string, ContactGuardContext["preferences"]>();
  if (customerIds.length) {
    const { data: currentPreferences, error: preferenceError } = await client
      .from("contact_preferences").select("*").in("customer_id", customerIds);
    if (preferenceError) {
      return { contexts: new Map(), error: "Unable to load current contact preferences." };
    }
    for (const preference of currentPreferences ?? []) preferenceMap.set(preference.customer_id, preference);
  }
  const contexts = new Map<string, ContactGuardContext>();
  for (const caseId of uniqueCaseIds) {
    const context = payload[caseId];
    if (!context) return { contexts: new Map(), error: "Contact guard returned incomplete case coverage." };
    contexts.set(caseId, {
      ...context,
      preferences: context.customer_id ? preferenceMap.get(context.customer_id) ?? context.preferences : context.preferences,
    });
  }
  return { contexts, error: null };
}

export function evaluationJson(evaluation: ContactGuardEvaluation): Json {
  return JSON.parse(JSON.stringify(evaluation)) as Json;
}
