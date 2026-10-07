import "server-only";

import { createHash } from "node:crypto";

/**
 * LHDN MyInvois API client, logged in as CollectBoss's intermediary system
 * and acting on behalf of each business's TIN (the `onbehalfof` header).
 */

export type MyInvoisEnvironment = "preprod" | "production";

export class MyInvoisError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message);
  }
}

const HOSTS: Record<MyInvoisEnvironment, { api: string; portal: string }> = {
  preprod: { api: "https://preprod-api.myinvois.hasil.gov.my", portal: "https://preprod.myinvois.hasil.gov.my" },
  production: { api: "https://api.myinvois.hasil.gov.my", portal: "https://myinvois.hasil.gov.my" },
};

export function myInvoisConfig() {
  const environment: MyInvoisEnvironment = process.env.MYINVOIS_ENVIRONMENT === "production" ? "production" : "preprod";
  const clientId = process.env.MYINVOIS_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.MYINVOIS_CLIENT_SECRET?.trim() ?? "";
  return { environment, clientId, clientSecret, configured: Boolean(clientId && clientSecret), hosts: HOSTS[environment] };
}

/** Public validation link printed on / shared with the e-Invoice. */
export function validationUrl(environment: MyInvoisEnvironment, uuid: string, longId: string) {
  return `${HOSTS[environment].portal}/${encodeURIComponent(uuid)}/share/${encodeURIComponent(longId)}`;
}

const tokens = new Map<string, { token: string; expiresAt: number }>();

async function accessToken(onBehalfOfTin: string): Promise<string> {
  const config = myInvoisConfig();
  if (!config.configured) throw new MyInvoisError("MyInvois is not configured.", "NOT_CONFIGURED", 503);
  const cached = tokens.get(onBehalfOfTin);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const response = await fetch(`${config.hosts.api}/connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", onbehalfof: onBehalfOfTin },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, grant_type: "client_credentials", scope: "InvoicingAPI" }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!response) throw new MyInvoisError("MyInvois could not be reached.", "NETWORK", 503);
  const payload = await response.json().catch(() => null) as { access_token?: string; expires_in?: number; error?: string } | null;
  if (!response.ok || !payload?.access_token) {
    // invalid_grant / unauthorised_client usually means the business has not authorised CollectBoss as its intermediary.
    throw new MyInvoisError(
      payload?.error === "invalid_grant" || payload?.error === "unauthorised_client"
        ? "LHDN has not authorised CollectBoss to submit for this business yet."
        : "MyInvois login failed.",
      payload?.error ?? "LOGIN_FAILED",
      response.status,
    );
  }
  tokens.set(onBehalfOfTin, { token: payload.access_token, expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000 });
  return payload.access_token;
}

async function call<T>(tin: string, path: string, init: RequestInit): Promise<T> {
  const config = myInvoisConfig();
  const token = await accessToken(tin);
  const response = await fetch(`${config.hosts.api}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json", ...init.headers },
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!response) throw new MyInvoisError("MyInvois could not be reached.", "NETWORK", 503);
  const payload = await response.json().catch(() => null) as (T & { error?: { code?: string; message?: string } }) | null;
  if (!response.ok) {
    throw new MyInvoisError(payload?.error?.message ?? `MyInvois returned ${response.status}.`, payload?.error?.code ?? String(response.status), response.status);
  }
  return payload as T;
}

export function prepareDocument(document: unknown) {
  const json = JSON.stringify(document);
  return {
    base64: Buffer.from(json, "utf8").toString("base64"),
    sha256: createHash("sha256").update(json, "utf8").digest("hex"),
  };
}

export async function submitDocument(tin: string, codeNumber: string, document: unknown) {
  const { base64, sha256 } = prepareDocument(document);
  if (base64.length > 300 * 1024 * 1.37) throw new MyInvoisError("The e-Invoice is too large.", "TOO_LARGE", 400);
  const result = await call<{
    submissionUid?: string; submissionUID?: string;
    acceptedDocuments?: Array<{ uuid: string; invoiceCodeNumber: string }>;
    rejectedDocuments?: Array<{ invoiceCodeNumber: string; error?: { code?: string; message?: string; details?: Array<{ message?: string }> } }>;
  }>(tin, "/api/v1.0/documentsubmissions/", {
    method: "POST",
    body: JSON.stringify({ documents: [{ format: "JSON", document: base64, documentHash: sha256, codeNumber }] }),
  });
  return {
    submissionUid: result.submissionUid ?? result.submissionUID ?? null,
    accepted: result.acceptedDocuments?.[0] ?? null,
    rejected: result.rejectedDocuments?.[0] ?? null,
    documentHash: sha256,
  };
}

export async function getSubmission(tin: string, submissionUid: string) {
  return call<{
    overallStatus: string;
    documentSummary: Array<{ uuid: string; longId?: string; status: string; dateTimeValidated?: string }>;
  }>(tin, `/api/v1.0/documentsubmissions/${encodeURIComponent(submissionUid)}?pageNo=1&pageSize=100`, { method: "GET" });
}

export async function getDocumentDetails(tin: string, uuid: string) {
  return call<{ validationResults?: { validationSteps?: Array<{ name?: string; status?: string; error?: { error?: string; innerError?: Array<{ error?: string }> } }> } }>(
    tin, `/api/v1.0/documents/${encodeURIComponent(uuid)}/details`, { method: "GET" },
  );
}

export async function cancelDocument(tin: string, uuid: string, reason: string) {
  return call<{ uuid: string; status: string }>(tin, `/api/v1.0/documents/state/${encodeURIComponent(uuid)}/state`, {
    method: "PUT",
    body: JSON.stringify({ status: "cancelled", reason: reason.slice(0, 300) }),
  });
}
