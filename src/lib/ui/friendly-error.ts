import { currentLocale, translate } from "@/lib/i18n/messages";

/**
 * Turns infrastructure wording from API responses into plain language before
 * it reaches the screen. Business messages ("The selected debt is
 * unavailable.", "Incorrect email or password.") pass through unchanged so
 * users still see why an action was refused.
 */

export const FRIENDLY_RETRY_MESSAGE =
  "We couldn't load this right now. Please check your connection and tap Retry.";
export const FRIENDLY_SESSION_MESSAGE = "Your session has ended. Please sign in again.";
export const FRIENDLY_RATE_LIMIT_MESSAGE = "Too many attempts. Please wait a minute and try again.";

const TECHNICAL_TERMS =
  /\b(supabase|tenant|service[_ ]role|rpc|schema|postgres|pgrst|jwt|webhook|projection|idempotency|env(ironment)? var|not configured|configuration)\b/i;
const INFRASTRUCTURE_UNAVAILABLE =
  /\b(service|services|store|queue|client|context|access|permissions|membership|reporting|scheduler|module|engine|worker)\b[^.]*\b(is|are)?\s*(temporarily\s+)?unavailable\b/i;
const NETWORK_FAILURE = /failed to fetch|networkerror|load failed|network request failed|fetch failed|aborted|timed? ?out/i;

export function isTechnicalErrorMessage(message: string): boolean {
  return TECHNICAL_TERMS.test(message) || INFRASTRUCTURE_UNAVAILABLE.test(message) || NETWORK_FAILURE.test(message);
}

export function friendlyErrorMessage(
  message: string | null | undefined,
  options: { status?: number; fallback?: string } = {},
): string {
  const { status } = options;
  const fallback = options.fallback ?? translate(currentLocale(), "error.retryGeneric");
  const locale = currentLocale();
  if (status === 401) return translate(locale, "error.session");
  if (status === 429) return translate(locale, "error.rateLimit");
  const text = typeof message === "string" ? message.trim() : "";
  if (!text) return fallback;
  if (isTechnicalErrorMessage(text)) return translate(locale, "error.retryGeneric");
  return text;
}
