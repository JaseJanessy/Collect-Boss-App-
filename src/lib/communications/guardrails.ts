import type {
  CommunicationChannel,
  ContactFrequencyCounts,
  ContactFrequencyPolicy,
  ContactGuardEvaluation,
  ContactPreferenceRow,
} from "@/lib/supabase/types";

export interface ContactGuardContext {
  case_id: string;
  customer_id: string | null;
  timezone: string;
  counts: ContactFrequencyCounts;
  policy: ContactFrequencyPolicy;
  preferences: ContactPreferenceRow | null;
}

function localMinutes(timezone: string, now: Date): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    const minute = Number(parts.find((part) => part.type === "minute")?.value);
    return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : null;
  } catch {
    return null;
  }
}

function parseTime(value: string | null): number | null {
  if (!value) return null;
  const match = /^(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function isWithinPreferredTime(
  startValue: string | null,
  endValue: string | null,
  timezone: string,
  now: Date,
) {
  const start = parseTime(startValue);
  const end = parseTime(endValue);
  const current = localMinutes(timezone, now);
  if (start === null || end === null || current === null) return true;
  return start < end ? current >= start && current < end : current >= start || current < end;
}

export function evaluateContactGuard(
  context: ContactGuardContext,
  channel: CommunicationChannel | null,
  options: { bulk?: boolean; overrideProvided?: boolean; now?: Date } = {},
): ContactGuardEvaluation {
  const warnings: string[] = [];
  const { counts, policy, preferences } = context;
  let hasFrequencyWarning = false;
  let hasPreferenceWarning = false;
  let recommendation = "Contact may proceed with professional judgment.";

  const frequencyWindows = [
    { count: counts.attempts_24h, max: policy.max_attempts_24h, label: "24 hours" },
    { count: counts.attempts_7d, max: policy.max_attempts_7d, label: "7 days" },
    { count: counts.attempts_30d, max: policy.max_attempts_30d, label: "30 days" },
  ];
  for (const window of frequencyWindows) {
    if (window.count >= window.max) {
      hasFrequencyWarning = true;
      warnings.push(`High contact frequency - ${window.count} attempts in ${window.label}.`);
    }
  }
  if (hasFrequencyWarning) recommendation = "No action recommended today.";

  if (preferences) {
    if (channel === "email" && preferences.do_not_email) {
      hasPreferenceWarning = true;
      warnings.push("Customer preference: do not email.");
      recommendation = "Do not send email. Use an approved alternative channel.";
    }
    if (channel === "email" && preferences.email_unsubscribed) {
      hasPreferenceWarning = true;
      warnings.push("This address has unsubscribed from email.");
      recommendation = "Do not send email. Use an approved alternative channel.";
    }
    if (channel === "email" && preferences.email_invalid) {
      hasPreferenceWarning = true;
      warnings.push("This email address is marked invalid or bounced.");
      recommendation = "Do not send email. Verify the address first.";
    }
    if (preferences.invalid_contact) {
      hasPreferenceWarning = true;
      warnings.push("Contact details are documented as invalid.");
      recommendation = "No action recommended today. Verify contact details first.";
    }
    if (preferences.wrong_number && (channel === null || channel === "call" || channel === "whatsapp")) {
      hasPreferenceWarning = true;
      warnings.push("This phone number is documented as a wrong number.");
      recommendation = "No action recommended today. Verify the phone number first.";
    }
    if (preferences.do_not_call && (channel === null || channel === "call")) {
      hasPreferenceWarning = true;
      warnings.push("Customer preference: do not call.");
      recommendation = channel === "call"
        ? "No action recommended today. Use a documented non-call channel."
        : "Use a documented non-call channel.";
    }
    if (preferences.email_only && channel !== null && channel !== "email") {
      hasPreferenceWarning = true;
      warnings.push("Customer preference: email only.");
      recommendation = "Use Email instead.";
    } else if (preferences.email_only && channel === null) {
      recommendation = hasFrequencyWarning ? recommendation : "Use Email for the next follow-up.";
    }
    if (channel && preferences.preferred_channel && channel !== preferences.preferred_channel) {
      hasPreferenceWarning = true;
      warnings.push(`Preferred contact channel is ${preferences.preferred_channel}.`);
      if (!hasFrequencyWarning && !preferences.invalid_contact && !preferences.wrong_number) {
        recommendation = `Use ${preferences.preferred_channel} instead.`;
      }
    }
    if (!isWithinPreferredTime(
      preferences.preferred_time_start,
      preferences.preferred_time_end,
      context.timezone,
      options.now ?? new Date(),
    )) {
      hasPreferenceWarning = true;
      warnings.push("Current time is outside the documented preferred contact time.");
      recommendation = "No action recommended today. Contact during the preferred time.";
    }
  }

  const requiresOverride =
    (hasFrequencyWarning && policy.frequency_mode === "require_override")
    || (hasPreferenceWarning && policy.preference_mode === "require_override");
  const hasWarning = hasFrequencyWarning || hasPreferenceWarning;
  const bulkAllowed = !hasWarning
    || (policy.bulk_mode === "require_override" && options.overrideProvided === true);

  return {
    case_id: context.case_id,
    channel,
    counts,
    warnings,
    has_frequency_warning: hasFrequencyWarning,
    has_preference_warning: hasPreferenceWarning,
    requires_override: requiresOverride,
    bulk_allowed: options.bulk ? bulkAllowed : true,
    recommended_action: recommendation,
    preferences,
    policy,
  };
}
