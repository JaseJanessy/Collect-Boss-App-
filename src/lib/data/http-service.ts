/**
 * Shared transport for browser-facing services.
 *
 * UI modules call a domain service, and domain services use this transport.
 * Keeping fetch/error parsing here prevents every component from inventing a
 * slightly different API contract.
 */
export class ServiceRequestError<TBody = unknown> extends Error {
  readonly status: number;
  readonly code?: string;
  readonly body: TBody;

  constructor(message: string, status: number, body: TBody, code?: string) {
    super(message);
    this.name = "ServiceRequestError";
    this.status = status;
    this.body = body;
    this.code = code;
  }
}

export function isServiceRequestError<TBody = unknown>(error: unknown): error is ServiceRequestError<TBody> {
  return error instanceof ServiceRequestError;
}

type ErrorPayload = { error?: string; code?: string };

export async function requestJson<TResponse>(
  url: string,
  init: RequestInit = {},
  fallbackMessage = "The request could not be completed.",
): Promise<TResponse> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, { ...init, headers });
  const body = await response.json().catch(() => ({})) as TResponse & ErrorPayload;

  if (!response.ok) {
    throw new ServiceRequestError(
      body.error || fallbackMessage,
      response.status,
      body,
      body.code,
    );
  }

  return body;
}

export async function requestBlob(
  url: string,
  init: RequestInit = {},
  fallbackMessage = "The requested file is unavailable.",
): Promise<Blob> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as ErrorPayload;
    throw new ServiceRequestError(body.error || fallbackMessage, response.status, body, body.code);
  }
  return response.blob();
}
