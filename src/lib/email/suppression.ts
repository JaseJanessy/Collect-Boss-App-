import "server-only";

import { createHash } from "node:crypto";
import type { AppSupabaseClient } from "@/lib/supabase/client";

export function normalizeEmailAddress(value: string) {
  return value.trim().toLowerCase();
}

export function emailRecipientHash(value: string) {
  return createHash("sha256").update(normalizeEmailAddress(value), "utf8").digest("hex");
}

export function maskEmailAddress(value: string) {
  const normalized = normalizeEmailAddress(value);
  const [local, domain] = normalized.split("@");
  if (!local || !domain) return "invalid-address";
  return `${local.slice(0, 1)}***@${domain}`.slice(0, 320);
}

export async function assertRecipientsNotSuppressed(
  client: AppSupabaseClient,
  businessId: string,
  recipients: string[],
) {
  const hashes = [...new Set(recipients.map(emailRecipientHash))];
  if (!hashes.length) return;
  const { data, error } = await client.from("email_suppressions").select("recipient_hash,reason")
    .eq("business_id", businessId).eq("active", true).in("recipient_hash", hashes);
  if (error) throw new Error("Email suppression status could not be checked.");
  if (data?.length) throw new Error("One or more recipients are suppressed after a delivery failure or complaint. Review Email Communications settings before retrying.");
}

export async function suppressEmailRecipient(input: {
  client: AppSupabaseClient;
  businessId: string;
  recipient: string;
  reason: "bounce" | "complaint" | "provider_suppression" | "manual" | "invalid";
  sourceEventId?: string | null;
}) {
  const { error } = await input.client.from("email_suppressions").upsert({
    business_id: input.businessId,
    recipient_hash: emailRecipientHash(input.recipient),
    masked_recipient: maskEmailAddress(input.recipient),
    reason: input.reason,
    source_event_id: input.sourceEventId ?? null,
    active: true,
    lifted_at: null,
    lifted_by: null,
  }, { onConflict: "business_id,recipient_hash" });
  if (error) throw new Error("Email suppression could not be persisted.");
}
