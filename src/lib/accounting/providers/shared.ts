import "server-only";

export type UnknownRecord = Record<string, unknown>;

export function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

export function records(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.map(record) : [];
}

export function text(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

export function nullableText(value: unknown) {
  return text(value) || null;
}

export function numeric(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(text(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function minor(value: unknown) {
  return Math.max(0, Math.round(numeric(value) * 100));
}

export function isoDate(value: unknown) {
  const raw = text(value);
  if (!raw) return null;
  const xero = raw.match(/^\/Date\((\d+)(?:[+-]\d+)?\)\/$/);
  const parsed = new Date(xero ? Number(xero[1]) : raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

export function isoInstant(value: unknown) {
  const raw = text(value);
  if (!raw) return null;
  const xero = raw.match(/^\/Date\((\d+)(?:[+-]\d+)?\)\/$/);
  const parsed = new Date(xero ? Number(xero[1]) : raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export async function fetchJson(url: string, init: RequestInit, context: string) {
  const response = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(30_000) });
  const body = await response.text();
  let parsed: unknown = null;
  try { parsed = body ? JSON.parse(body) : null; } catch { parsed = null; }
  if (!response.ok) {
    const requestId = response.headers.get("x-request-id") ?? response.headers.get("intuit_tid");
    throw new Error(`${context} failed (${response.status}${requestId ? `, request ${requestId}` : ""}).`);
  }
  return parsed;
}

export function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Accounting integration is unavailable: ${name} is not configured.`);
  return value;
}

export function tokenExpiry(expiresIn: unknown) {
  const seconds = Math.max(60, numeric(expiresIn) || 3600);
  return new Date(Date.now() + seconds * 1000).toISOString();
}
