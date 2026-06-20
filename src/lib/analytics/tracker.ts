/**
 * CollectBoss Analytics Tracker
 *
 * Privacy rules (hard-coded):
 *  ✗ Never log phone numbers, IC numbers, bank account numbers
 *  ✗ Never log uploaded file contents
 *  ✗ Never log full email addresses (use hashed / domain-only)
 *  ✓ Safe to log: event names, case IDs (CB-xxxx), enum values, counts, boolean flags
 *
 * Swapping providers:
 *  Replace the `providers` array below with PostHog, Mixpanel, Sentry, etc.
 *  The `track` / `identify` / `trackError` API stays the same.
 */

// ─── Event catalog ─────────────────────────────────────────────────────────────

export type AnalyticsEvent =
  | "user_registered"
  | "business_profile_created"
  | "case_created"
  | "evidence_uploaded"
  | "reminder_generated"
  | "payment_access_requested"
  | "payment_access_approved"
  | "payment_proof_submitted"
  | "payment_approved"
  | "evidence_pack_exported";

// ─── Safe property shapes per event ───────────────────────────────────────────
// All fields are optional — add only what is safe. NO PII.

export interface EventProperties {
  user_registered:            { method?: "email" };
  business_profile_created:   { payment_lock_mode?: string };
  case_created:               { payment_lock_mode?: string; has_invoice?: boolean };
  evidence_uploaded:          { evidence_type: string; file_size_bucket: string };
  reminder_generated:         { reminder_type: string; channel?: string };
  payment_access_requested:   { case_id: string };
  payment_access_approved:    { case_id: string; access_type: string };
  payment_proof_submitted:    { case_id: string; payment_method: string; has_proof_file: boolean };
  payment_approved:           { case_id: string };
  evidence_pack_exported:     { case_id: string; evidence_score: number; file_count: number };
}

// ─── Provider interface (swap in PostHog / Mixpanel / Sentry here) ─────────────

interface AnalyticsProvider {
  name: string;
  track(event: string, properties: Record<string, unknown>): void;
  identify(userId: string, traits: Record<string, unknown>): void;
  trackError(error: Error, context?: Record<string, unknown>): void;
}

// ─── Console provider (development) ───────────────────────────────────────────

const consoleProvider: AnalyticsProvider = {
  name: "console",

  track(event, properties) {
    console.groupCollapsed(
      `%c[Analytics] %c${event}`,
      "color: #009966; font-weight: bold",
      "color: #0D1B3D; font-weight: bold",
    );
    if (Object.keys(properties).length > 0) {
      console.table(properties);
    }
    console.groupEnd();
  },

  identify(userId, traits) {
    console.log(
      `%c[Analytics] identify %c${userId}`,
      "color: #009966; font-weight: bold",
      "color: #0D1B3D",
      traits,
    );
  },

  trackError(error, context) {
    console.error(
      `%c[Analytics] error %c${error.message}`,
      "color: #cc0000; font-weight: bold",
      "color: #cc0000",
      { stack: error.stack, ...context },
    );
  },
};

// ─── No-op provider (production until a real provider is wired) ──────────────

const noopProvider: AnalyticsProvider = {
  name: "noop",
  track:      () => undefined,
  identify:   () => undefined,
  trackError: () => undefined,
};

// ─── Active provider list ─────────────────────────────────────────────────────

function getProviders(): AnalyticsProvider[] {
  const isDev = process.env.NODE_ENV === "development";
  return isDev ? [consoleProvider] : [noopProvider];
  // When you add a real provider (PostHog, Mixpanel, Sentry), push it here:
  // e.g. if (process.env.NEXT_PUBLIC_POSTHOG_KEY) providers.push(posthogProvider);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Track a named event with safe (non-PII) properties.
 *
 * @example
 * track("case_created", { payment_lock_mode: "approval", has_invoice: true });
 */
export function track<E extends AnalyticsEvent>(
  event: E,
  properties?: E extends keyof EventProperties ? EventProperties[E] : never,
): void {
  const providers = getProviders();
  const safeProps = sanitize((properties as Record<string, unknown>) ?? {});
  providers.forEach((p) => p.track(event, safeProps));
}

/**
 * Associate the current session with a user.
 * Only pass a hashed / opaque user ID — never a raw email or phone.
 */
export function identify(userId: string): void {
  const providers = getProviders();
  providers.forEach((p) => p.identify(userId, {}));
}

/**
 * Record a caught error.
 */
export function trackError(
  error: Error,
  context?: { page?: string; action?: string; digest?: string },
): void {
  const providers = getProviders();
  providers.forEach((p) =>
    p.trackError(error, {
      message: error.message,
      // Trim stack to first 3 lines only — avoids logging sensitive values
      stack:   error.stack?.split("\n").slice(0, 3).join("\n"),
      ...context,
    }),
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Strip any obviously sensitive keys before sending.
 * This is a safety net — callers should never pass PII in the first place.
 */
const BLOCKED_KEYS = new Set([
  "phone", "email", "ic", "nric", "bank_account", "account_number",
  "password", "token", "secret", "key", "file_content", "proof_url",
]);

function sanitize(obj: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (BLOCKED_KEYS.has(k.toLowerCase())) continue;
    safe[k] = v;
  }
  return safe;
}

/**
 * Bucket a file size into a human-readable range (avoids logging exact sizes).
 * e.g. 153_000 → "100KB–500KB"
 */
export function fileSizeBucket(bytes: number): string {
  if (bytes < 50_000)    return "<50KB";
  if (bytes < 500_000)   return "50KB–500KB";
  if (bytes < 2_000_000) return "500KB–2MB";
  return ">2MB";
}
