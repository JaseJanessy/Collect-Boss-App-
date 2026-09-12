import "server-only";

import { decryptAccountingSecret, encryptAccountingSecret } from "./crypto";
import { getAccountingAdapter } from "./providers";
import type {
  AccountingConnectionRecord, AccountingEntityKind, NormalizedAccountingRecord,
} from "./types";
import { getServiceClient } from "@/lib/supabase/service-client";
import { requestHash } from "@/lib/payment-matching/validation";
import { enqueueIntegrationJob, recordIntegrationHealth } from "@/lib/integrations/queue";
import type { AppSupabaseClient } from "@/lib/supabase/client";

const SYNC_ORDER: AccountingEntityKind[] = ["contact", "invoice", "payment", "credit_note"];
const MAX_PAGES_PER_ENTITY = 100;
const MAX_PREVIEW_RECORDS = 250;

export type AccountingSyncMode = "full" | "incremental" | "preview";

function publicError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown accounting sync error.";
  return message.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 1000);
}

function isCredentialFailure(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return /invalid[_ -]?grant|unauthori[sz]ed|token.+(?:expired|revoked)|reconnect|\b401\b/i.test(message);
}

async function loadConnection(connectionId: string) {
  const service = await getServiceClient();
  if (!service) throw new Error("Supabase service access is unavailable.");
  const { data, error } = await service.from("accounting_connections").select("*").eq("id", connectionId).maybeSingle();
  if (error || !data) throw new Error("Accounting connection was not found.");
  return { service, connection: data as AccountingConnectionRecord };
}

async function recordsSafeToApply(
  service: AppSupabaseClient,
  connection: AccountingConnectionRecord,
  records: NormalizedAccountingRecord[],
) {
  if (!records.length) return records;
  const externalIds = records.map((record) => record.externalId);
  const { data: mappings, error } = await service.from("accounting_external_mappings")
    .select("external_entity_id,collectboss_entity_id,source_updated_at,entity_type")
    .eq("business_id", connection.business_id).eq("connection_id", connection.id)
    .in("external_entity_id", externalIds);
  if (error) throw new Error("Existing accounting mappings could not be checked.");
  const byKey = new Map((mappings ?? []).map((mapping) => [`${mapping.entity_type}:${mapping.external_entity_id}`, mapping]));
  const eligible = records.filter((record) => {
    const mapping = byKey.get(`${record.kind}:${record.externalId}`);
    if (!mapping?.source_updated_at || !record.updatedAt) return true;
    return new Date(record.updatedAt).getTime() >= new Date(mapping.source_updated_at).getTime();
  });
  const invoiceIds = eligible.filter((record) => record.kind === "invoice")
    .map((record) => byKey.get(`invoice:${record.externalId}`)?.collectboss_entity_id)
    .filter((value): value is string => Boolean(value));
  if (invoiceIds.length) {
    const { data: obligations, error: obligationError } = await service.from("obligations").select("id,currency")
      .eq("business_id", connection.business_id).in("id", invoiceIds);
    if (obligationError) throw new Error("Mapped invoice currencies could not be checked.");
    const currencies = new Map((obligations ?? []).map((obligation) => [String(obligation.id), String(obligation.currency)]));
    for (const record of eligible) {
      if (record.kind !== "invoice") continue;
      const mappedId = byKey.get(`invoice:${record.externalId}`)?.collectboss_entity_id;
      const existingCurrency = mappedId ? currencies.get(mappedId) : null;
      if (existingCurrency && existingCurrency !== record.currency) {
        throw new Error(`CONFIGURATION_REQUIRED: Invoice ${record.reference} changed currency from ${existingCurrency} to ${record.currency}. Review the mapping before syncing.`);
      }
    }
  }
  return eligible;
}

async function usableAccessToken(connection: AccountingConnectionRecord) {
  if (!connection.access_token_ciphertext || !connection.refresh_token_ciphertext || !connection.external_tenant_id) {
    throw new Error("Accounting connection credentials are unavailable. Reconnect the provider.");
  }
  const adapter = getAccountingAdapter(connection.provider);
  const expiresAt = connection.token_expires_at ? new Date(connection.token_expires_at).getTime() : 0;
  if (expiresAt > Date.now() + 5 * 60_000) return decryptAccountingSecret(connection.access_token_ciphertext);

  let refreshed: Awaited<ReturnType<typeof adapter.refreshTokens>>;
  try {
    refreshed = await adapter.refreshTokens(decryptAccountingSecret(connection.refresh_token_ciphertext));
  } catch (error) {
    if (isCredentialFailure(error)) {
      const service = await getServiceClient();
      if (service) {
        await service.from("accounting_connections").update({
          status: "revoked", access_token_ciphertext: null, refresh_token_ciphertext: null,
          token_expires_at: null, last_error_code: "OAUTH_RECONNECT_REQUIRED",
          last_error_message: "Provider access expired or was revoked. Reconnect this integration.",
          updated_at: new Date().toISOString(),
        }).eq("id", connection.id).eq("business_id", connection.business_id);
      }
      await recordIntegrationHealth({
        businessId: connection.business_id, provider: connection.provider, succeeded: false,
        errorCode: "OAUTH_RECONNECT_REQUIRED", actionRequired: true,
        actionableMessage: "Provider access expired or was revoked. Reconnect this integration before retrying.",
      }).catch(() => undefined);
      throw new Error("Provider access expired or was revoked. Reconnect this integration.");
    }
    throw error;
  }
  const service = await getServiceClient();
  if (!service) throw new Error("Supabase service access is unavailable.");
  const { error } = await service.from("accounting_connections").update({
    access_token_ciphertext: encryptAccountingSecret(refreshed.accessToken),
    refresh_token_ciphertext: encryptAccountingSecret(refreshed.refreshToken),
    token_expires_at: refreshed.expiresAt,
    scopes: refreshed.scopes,
    updated_at: new Date().toISOString(),
  }).eq("id", connection.id).eq("business_id", connection.business_id);
  if (error) throw new Error("Refreshed accounting credentials could not be stored.");
  return refreshed.accessToken;
}

export async function syncAccountingConnection(
  connectionId: string,
  mode: AccountingSyncMode,
  options: { enqueueFailure?: boolean } = {},
) {
  const { service, connection } = await loadConnection(connectionId);
  if (connection.status !== "connected" && connection.status !== "error") {
    throw new Error("Reconnect this accounting provider before syncing.");
  }
  if (!connection.external_tenant_id) throw new Error("The connected accounting organization is missing.");

  const { data: run, error: runError } = await service.from("accounting_sync_runs").insert({
    business_id: connection.business_id,
    connection_id: connection.id,
    provider: connection.provider,
    mode,
    status: "running",
    started_at: new Date().toISOString(),
  }).select("id").single();
  if (runError || !run) {
    const alreadyRunning = runError?.message?.includes("accounting_sync_runs_one_active_idx");
    throw new Error(alreadyRunning ? "A sync is already running for this provider." : "Unable to start accounting sync.");
  }

  const runId = String(run.id);
  const startedAt = new Date().toISOString();
  await service.from("accounting_connections").update({
    last_attempted_sync_at: startedAt, last_error_code: null, last_error_message: null,
  }).eq("id", connection.id).eq("business_id", connection.business_id);

  const counts: Record<AccountingEntityKind, number> = { contact: 0, invoice: 0, payment: 0, credit_note: 0 };
  const preview: NormalizedAccountingRecord[] = [];
  try {
    const accessToken = await usableAccessToken(connection);
    const adapter = getAccountingAdapter(connection.provider);
    const overlapSince = mode === "incremental" && connection.last_successful_sync_at
      ? new Date(new Date(connection.last_successful_sync_at).getTime() - 5 * 60_000).toISOString()
      : null;

    for (const kind of SYNC_ORDER) {
      let cursor: string | null = null;
      for (let pageNumber = 0; pageNumber < MAX_PAGES_PER_ENTITY; pageNumber += 1) {
        const page = await adapter.fetchPage({
          accessToken,
          externalTenantId: connection.external_tenant_id,
          kind,
          cursor,
          modifiedSince: overlapSince,
        });
        const applicableRecords = await recordsSafeToApply(service, connection, page.records);
        counts[kind] += applicableRecords.length;
        if (mode === "preview") {
          preview.push(...applicableRecords.slice(0, Math.max(0, MAX_PREVIEW_RECORDS - preview.length)));
        } else if (applicableRecords.length) {
          const paymentRecords = applicableRecords.filter((record) => record.kind === "payment");
          const legacyRecords = applicableRecords.filter((record) => record.kind !== "payment");
          if (legacyRecords.length) {
            const { error } = await service.rpc("accounting_apply_sync_batch", {
              p_connection_id: connection.id,
              p_records: legacyRecords,
            });
            if (error) throw new Error(`The ${kind.replace("_", " ")} batch was rolled back: ${error.message}`);
          }
          if (paymentRecords.length) {
            if (paymentRecords.some((record) => !record.currency)) {
              throw new Error("An accounting payment is missing its source currency; no candidate was created.");
            }
            const normalized = paymentRecords.map((record) => {
              const transaction = {
                sourceType: "accounting" as const,
                sourceSystem: connection.provider,
                sourceRecordId: record.externalId,
                sourceBatchKey: runId,
                importBatchId: null,
                amountMinor: record.amountMinor,
                currency: record.currency!,
                occurredAt: record.occurredOn ? new Date(record.occurredOn).toISOString() : null,
                reference: record.reference,
                invoiceNumber: record.invoiceExternalId,
                partyName: null,
                accountReference: null,
                phone: null,
                phoneMatchPermitted: false,
                duplicateOfTransactionId: null,
                duplicateSignals: [],
                metadata: { accountingConnectionId: connection.id, accountingSyncRunId: runId },
              };
              return { ...transaction, fingerprintHash: requestHash(transaction) };
            });
            const idempotencyKey = `accounting:${runId}:${kind}:${pageNumber}`;
            const { error } = await service.rpc("payment_matching_import_transactions", {
              p_business_id: connection.business_id,
              p_actor_id: connection.created_by,
              p_transactions: normalized,
              p_idempotency_key: idempotencyKey,
              p_request_hash: requestHash(normalized),
            });
            if (error) throw new Error(`The accounting payment batch was rolled back: ${error.message}`);
          }
        }
        cursor = page.nextCursor;
        if (!cursor || (mode === "preview" && preview.length >= MAX_PREVIEW_RECORDS)) break;
      }
      if (mode === "preview" && preview.length >= MAX_PREVIEW_RECORDS) break;
    }

    const finishedAt = new Date().toISOString();
    await service.from("accounting_sync_runs").update({
      status: mode === "preview" ? "preview_ready" : "succeeded",
      finished_at: finishedAt,
      counts,
      preview: mode === "preview" ? preview : [],
    }).eq("id", runId).eq("business_id", connection.business_id);
    await service.from("accounting_connections").update({
      status: "connected",
      ...(mode === "preview" ? {} : { last_successful_sync_at: finishedAt, last_cursor: finishedAt }),
      last_error_code: null, last_error_message: null, updated_at: finishedAt,
    }).eq("id", connection.id).eq("business_id", connection.business_id);
    await recordIntegrationHealth({
      businessId: connection.business_id, provider: connection.provider, succeeded: true,
      metadata: { connectionId: connection.id, mode },
    }).catch(() => undefined);
    return { runId, mode, counts, preview: mode === "preview" ? preview : undefined };
  } catch (error) {
    const message = publicError(error);
    const credentialFailure = isCredentialFailure(error);
    const configurationRequired = message.startsWith("CONFIGURATION_REQUIRED:");
    const finishedAt = new Date().toISOString();
    await service.from("accounting_sync_runs").update({
      status: "failed", finished_at: finishedAt, counts,
      errors: [{ code: credentialFailure ? "OAUTH_RECONNECT_REQUIRED" : "PROVIDER_OR_MAPPING_FAILURE", message }],
    }).eq("id", runId).eq("business_id", connection.business_id);
    await service.from("accounting_connections").update({
      status: credentialFailure ? "revoked" : "error",
      last_error_code: credentialFailure ? "OAUTH_RECONNECT_REQUIRED" : configurationRequired ? "MAPPING_REVIEW_REQUIRED" : "SYNC_FAILED",
      last_error_message: message, updated_at: finishedAt,
    }).eq("id", connection.id).eq("business_id", connection.business_id);
    await recordIntegrationHealth({
      businessId: connection.business_id, provider: connection.provider, succeeded: false,
      errorCode: credentialFailure ? "OAUTH_RECONNECT_REQUIRED" : configurationRequired ? "MAPPING_REVIEW_REQUIRED" : "SYNC_FAILED",
      actionRequired: credentialFailure || configurationRequired,
      actionableMessage: credentialFailure
        ? "Provider access expired or was revoked. Reconnect this integration before retrying."
        : configurationRequired ? message.replace(/^CONFIGURATION_REQUIRED:\s*/, "")
        : "The sync failed and is queued for an automatic retry. Core case work remains available.",
      metadata: { connectionId: connection.id, mode, runId },
    }).catch(() => undefined);
    if (mode !== "preview" && options.enqueueFailure !== false && !credentialFailure && !configurationRequired) {
      await enqueueIntegrationJob({
        provider: connection.provider, jobType: "accounting_sync", businessId: connection.business_id,
        resourceId: connection.id, operationKey: runId, createdBy: connection.created_by,
        payload: { connectionId: connection.id, mode },
      }).catch(() => undefined);
    }
    throw new Error(message);
  }
}

export async function runAccountingReconciliation(limit = 25) {
  const service = await getServiceClient();
  if (!service) throw new Error("Supabase service access is unavailable.");
  const { data, error } = await service.from("accounting_connections").select("id,provider,external_tenant_id,last_successful_sync_at")
    .in("status", ["connected", "error"]).order("last_successful_sync_at", { ascending: true, nullsFirst: true }).limit(limit);
  if (error) throw new Error("Unable to load accounting reconciliation queue.");
  const results: Array<{ id: string; status: "succeeded" | "failed"; error?: string }> = [];
  for (const row of data ?? []) {
    const id = String(row.id);
    try {
      await syncAccountingConnection(id, row.last_successful_sync_at ? "incremental" : "full");
      if (row.external_tenant_id) {
        await service.from("accounting_webhook_events").update({
          status: "processed", processed_at: new Date().toISOString(), last_error: null,
        }).eq("provider", row.provider).eq("external_tenant_id", row.external_tenant_id).eq("status", "pending");
      }
      results.push({ id, status: "succeeded" });
    } catch (syncError) {
      results.push({ id, status: "failed", error: publicError(syncError) });
    }
  }
  return results;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function requiredText(record: Record<string, unknown>, key: string) {
  const value = typeof record[key] === "string" ? record[key].trim() : "";
  if (!value) throw new Error(`Payment write-back is missing ${key}.`);
  return value;
}

export async function processPaymentOperationOutbox(limit = 50) {
  const service = await getServiceClient();
  if (!service) throw new Error("Supabase service access is unavailable.");
  const now = new Date().toISOString();
  const { data: queued, error } = await service.from("accounting_payment_operation_outbox").select("*")
    .in("status", ["pending", "failed"]).lte("next_attempt_at", now).order("created_at").limit(limit);
  if (error) throw new Error("Unable to load accounting payment write-back queue.");
  const results: Array<{ id: string; status: "synced" | "failed" | "configuration_required" | "dead_letter"; error?: string }> = [];
  for (const candidate of queued ?? []) {
    const { data: claimed } = await service.from("accounting_payment_operation_outbox").update({
      status: "processing", locked_at: now, attempts: candidate.attempts + 1, updated_at: now,
    }).eq("id", candidate.id).eq("business_id", candidate.business_id).in("status", ["pending", "failed"]).select("*").maybeSingle();
    if (!claimed) continue;
    try {
      if (claimed.operation_type !== "allocation") throw new Error("CONFIGURATION_REQUIRED: Provider reversal/refund write-back is not enabled.");
      const { data: connection } = await service.from("accounting_connections").select("*").eq("id", claimed.connection_id).eq("business_id", claimed.business_id).maybeSingle();
      if (!connection) throw new Error("CONFIGURATION_REQUIRED: Accounting connection is unavailable.");
      const typedConnection = connection as AccountingConnectionRecord;
      const adapter = getAccountingAdapter(typedConnection.provider);
      if (!adapter.capabilities.writeBack || !adapter.createPaymentAllocation) throw new Error("CONFIGURATION_REQUIRED: This provider does not support payment write-back.");
      const writeback = objectValue(objectValue(typedConnection.metadata).paymentWriteback);
      const cashAccountId = requiredText(writeback, "cashAccountId");
      const payload = objectValue(claimed.payload);
      const obligationId = requiredText(payload, "obligationId");
      const { data: invoiceMapping } = await service.from("accounting_external_mappings").select("external_entity_id,external_parent_id")
        .eq("connection_id", claimed.connection_id).eq("business_id", claimed.business_id).eq("collectboss_entity_type", "obligation").eq("collectboss_entity_id", obligationId).maybeSingle();
      if (!invoiceMapping) throw new Error("CONFIGURATION_REQUIRED: The allocated invoice has no provider mapping.");
      const amountMinor = Number(payload.amountMinor);
      if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new Error("Payment write-back amount is invalid.");
      const accessToken = await usableAccessToken(typedConnection);
      const output = await adapter.createPaymentAllocation(accessToken, typedConnection.external_tenant_id ?? "", {
        externalInvoiceId: invoiceMapping.external_entity_id, externalCustomerId: invoiceMapping.external_parent_id,
        cashAccountId, amountMinor, currency: requiredText(payload, "currency"), occurredOn: requiredText(payload, "receivedOn"),
        reference: typeof payload.reference === "string" ? payload.reference : null, idempotencyKey: claimed.id,
      });
      const { data: allocation } = await service.from("payment_allocations").select("payment_id").eq("id", claimed.source_id).eq("business_id", claimed.business_id).maybeSingle();
      if (allocation?.payment_id) {
        const { error: mappingError } = await service.from("accounting_external_mappings").upsert({
          business_id: claimed.business_id, connection_id: claimed.connection_id, provider: claimed.provider, entity_type: "payment",
          external_entity_id: output.externalRecordId, external_parent_id: invoiceMapping.external_entity_id,
          collectboss_entity_type: "payment", collectboss_entity_id: allocation.payment_id, last_synced_at: new Date().toISOString(),
          metadata: { payment_operation_outbox_id: claimed.id, idempotency_key: claimed.idempotency_key },
        }, { onConflict: "business_id,provider,entity_type,external_entity_id" });
        if (mappingError) throw new Error("The accounting write-back succeeded but its idempotent mapping could not be stored.");
      }
      const finishedAt = new Date().toISOString();
      await service.from("accounting_payment_operation_outbox").update({ status: "synced", external_record_id: output.externalRecordId, synced_at: finishedAt, locked_at: null, last_error_code: null, last_error_message: null, updated_at: finishedAt }).eq("id", claimed.id).eq("status", "processing");
      results.push({ id: claimed.id, status: "synced" });
    } catch (writeError) {
      const message = publicError(writeError);
      const configurationRequired = message.startsWith("CONFIGURATION_REQUIRED:") || message.includes("missing cashAccountId");
      const deadLetter = !configurationRequired && claimed.attempts >= 8;
      const retryMinutes = Math.min(24 * 60, 2 ** Math.min(claimed.attempts, 10));
      const retryAt = new Date(Date.now() + retryMinutes * 60_000).toISOString();
      await service.from("accounting_payment_operation_outbox").update({
        status: configurationRequired ? "configuration_required" : deadLetter ? "dead_letter" : "failed", locked_at: null,
        last_error_code: configurationRequired ? "CONFIGURATION_REQUIRED" : deadLetter ? "WRITEBACK_DEAD_LETTER" : "WRITEBACK_FAILED",
        last_error_message: message, next_attempt_at: retryAt, updated_at: new Date().toISOString(),
      }).eq("id", claimed.id).eq("status", "processing");
      results.push({ id: claimed.id, status: configurationRequired ? "configuration_required" : deadLetter ? "dead_letter" : "failed", error: message });
    }
  }
  return results;
}
