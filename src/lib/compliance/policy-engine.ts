import { createHash } from "node:crypto";
import type { CommunicationChannel } from "@/lib/supabase/types";
import type {
  ComplianceApprovalLevel,
  ComplianceEvaluation,
  ComplianceEvaluationInput,
  CompliancePolicyRules,
  CompliancePolicyVersion,
  SensitiveCaseCategory,
} from "./types";

const approvalRank: Record<ComplianceApprovalLevel, number> = {
  automatic: 0,
  agent: 1,
  supervisor: 2,
  legal: 3,
  prohibited: 4,
};

export const MALAYSIA_DRAFT_POLICY_RULES: CompliancePolicyRules = {
  policy_notice: "Draft operational safeguards only. This policy is not legal advice, does not guarantee compliance, and must not be activated until documented review by qualified Malaysian counsel.",
  contact_windows: {
    email: { start: "08:00", end: "20:00", days: [1, 2, 3, 4, 5, 6] },
    whatsapp: { start: "08:00", end: "20:00", days: [1, 2, 3, 4, 5, 6] },
    call: { start: "09:00", end: "18:00", days: [1, 2, 3, 4, 5] },
    other: { start: "08:00", end: "20:00", days: [1, 2, 3, 4, 5, 6] },
  },
  frequency: { max_attempts_24h: 2, max_attempts_7d: 5, max_attempts_30d: 12 },
  prohibited_phrases: [
    { id: "guaranteed_arrest", phrases: ["you will be arrested", "we will have you arrested"], approval: "prohibited", warning: "Message contains an arrest threat." },
    { id: "guaranteed_imprisonment", phrases: ["you will go to jail", "you will be imprisoned"], approval: "prohibited", warning: "Message contains an imprisonment threat." },
  ],
  threat_indicators: ["we will ruin you", "pay or else", "visit your workplace", "contact your employer"],
  authority_impersonation_indicators: ["we are the court", "on behalf of the police", "government enforcement unit", "court officer"],
  unsupported_legal_claim_indicators: ["legal action is guaranteed", "you have committed a crime", "court judgment has been entered", "warrant has been issued"],
  third_party_disclosure_indicators: ["tell your family about this debt", "inform your employer of this debt", "notify your neighbours"],
  sensitive_case_indicators: {
    identity_theft: ["identity theft", "stolen identity", "not my account"],
    paid_in_full_dispute: ["paid in full", "already paid everything", "nothing outstanding"],
    legal_representation: ["my lawyer", "my solicitor", "represented by counsel", "contact my attorney"],
    serious_complaint: ["formal complaint", "reporting harassment", "regulator complaint"],
    vulnerability: ["financial hardship", "medical emergency", "mental health crisis", "cannot afford food"],
    bereavement: ["passed away", "deceased", "bereavement", "died"],
    wrong_party: ["wrong person", "wrong party", "do not know this person", "not the debtor"],
  },
  unverified_balance: {
    block_amount_references: true,
    amount_reference_indicators: ["rm", "myr", "amount due", "outstanding balance", "total owed", "pay "],
  },
  approval_thresholds: { amount_minor_supervisor: 100_000, bulk_requires_supervisor: true },
};

function normalize(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("en").replace(/\s+/g, " ").trim();
}

function includesAny(text: string, phrases: string[]) {
  return phrases.some((phrase) => text.includes(normalize(phrase)));
}

function raise(current: ComplianceApprovalLevel, next: ComplianceApprovalLevel) {
  return approvalRank[next] > approvalRank[current] ? next : current;
}

function localTime(timezone: string, now: Date) {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const weekday = parts.find((part) => part.type === "weekday")?.value;
    const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday ?? "");
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    const minute = Number(parts.find((part) => part.type === "minute")?.value);
    if (day < 0 || !Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    return { day, minutes: hour * 60 + minute };
  } catch {
    return null;
  }
}

function minutes(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function withinWindow(channel: CommunicationChannel, rules: CompliancePolicyRules, timezone: string, now: Date) {
  const window = rules.contact_windows[channel];
  if (!window) return true;
  const local = localTime(timezone, now);
  const start = minutes(window.start);
  const end = minutes(window.end);
  if (!local || start === null || end === null || !window.days.includes(local.day)) return false;
  return start < end
    ? local.minutes >= start && local.minutes < end
    : local.minutes >= start || local.minutes < end;
}

export function hashComplianceContent(input: {
  channel: CommunicationChannel;
  subject?: string | null;
  bodyText?: string | null;
  recipients?: string[];
  caseId: string;
}) {
  const canonical = JSON.stringify({
    case_id: input.caseId,
    channel: input.channel,
    subject: input.subject?.normalize("NFKC").trim() ?? "",
    body_text: input.bodyText?.normalize("NFKC").trim() ?? "",
    recipients: [...new Set((input.recipients ?? []).map((value) => value.trim().toLowerCase()))].sort(),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function evaluateCompliancePolicy(
  policy: CompliancePolicyVersion,
  input: ComplianceEvaluationInput,
): ComplianceEvaluation {
  const rules = policy.rules;
  const text = normalize(`${input.subject ?? ""}\n${input.bodyText ?? ""}`);
  const warnings: string[] = [];
  const signals: string[] = [];
  const sensitive = new Set<SensitiveCaseCategory>(input.activeSensitiveCategories ?? []);
  let required: ComplianceApprovalLevel = "automatic";

  if (!withinWindow(input.channel, rules, input.timezone, input.now)) {
    required = raise(required, "agent");
    signals.push("outside_contact_window");
    warnings.push("The proposed contact time is outside the configured operational window.");
  }
  const frequencyChecks = [
    [input.counts.attempts_24h, rules.frequency.max_attempts_24h, "24 hours"],
    [input.counts.attempts_7d, rules.frequency.max_attempts_7d, "7 days"],
    [input.counts.attempts_30d, rules.frequency.max_attempts_30d, "30 days"],
  ] as const;
  for (const [count, maximum, label] of frequencyChecks) {
    if (count >= maximum) {
      required = raise(required, "supervisor");
      signals.push(`frequency_${label.replace(" ", "_")}`);
      warnings.push(`Configured contact-frequency limit reached for ${label}.`);
    }
  }

  if (input.preferences?.invalid_contact || input.preferences?.wrong_number) {
    required = "prohibited";
    signals.push(input.preferences.wrong_number ? "wrong_party_risk" : "invalid_contact");
    warnings.push("Contact details are marked invalid or wrong-party risk is present.");
    if (input.preferences.wrong_number) sensitive.add("wrong_party");
  }
  if (input.channel === "email" && (input.preferences?.do_not_email || input.preferences?.email_unsubscribed)) {
    required = "prohibited";
    signals.push("email_restricted");
    warnings.push("Email is restricted by the recorded contact preference or opt-out state.");
  }
  if (input.channel === "call" && input.preferences?.do_not_call) {
    required = "prohibited";
    signals.push("call_restricted");
    warnings.push("Calls are restricted by the recorded contact preference.");
  }
  if (input.preferences?.preferred_channel && input.preferences.preferred_channel !== input.channel) {
    required = raise(required, "agent");
    signals.push("non_preferred_channel");
    warnings.push(`The configured preferred channel is ${input.preferences.preferred_channel}.`);
  }

  for (const phraseRule of rules.prohibited_phrases) {
    if (includesAny(text, phraseRule.phrases)) {
      required = raise(required, phraseRule.approval);
      signals.push(`phrase:${phraseRule.id}`);
      warnings.push(phraseRule.warning);
    }
  }
  if (includesAny(text, rules.threat_indicators)) {
    required = "prohibited";
    signals.push("likely_threat");
    warnings.push("Message contains language consistent with a threat or coercive escalation.");
  }
  if (includesAny(text, rules.authority_impersonation_indicators)) {
    required = "prohibited";
    signals.push("authority_impersonation");
    warnings.push("Message may impersonate a court, police, government, or other authority.");
  }
  if (includesAny(text, rules.unsupported_legal_claim_indicators)) {
    required = raise(required, "legal");
    signals.push("unsupported_legal_claim");
    warnings.push("Message contains a legal assertion that requires documented qualified review.");
  }
  if (includesAny(text, rules.third_party_disclosure_indicators)) {
    required = "prohibited";
    signals.push("third_party_disclosure");
    warnings.push("Message may disclose collection information to a third party.");
  }

  for (const [category, indicators] of Object.entries(rules.sensitive_case_indicators) as Array<[SensitiveCaseCategory, string[]]>) {
    if (includesAny(text, indicators)) sensitive.add(category);
  }
  if (sensitive.size) {
    required = raise(required, "supervisor");
    signals.push(...[...sensitive].map((category) => `sensitive:${category}`));
    warnings.push("Sensitive-case indicators require standard automation to pause for owned review.");
  }

  if (rules.unverified_balance.block_amount_references
    && input.unverifiedBalanceMinor > 0
    && includesAny(text, rules.unverified_balance.amount_reference_indicators)) {
    required = "prohibited";
    signals.push("unverified_amount_reference");
    warnings.push("The message refers to an amount while the case includes an unverified balance.");
  }
  if (input.requestedAmountMinor != null && input.requestedAmountMinor > input.confirmedOutstandingMinor) {
    required = "prohibited";
    signals.push("amount_exceeds_confirmed_balance");
    warnings.push("Requested amount exceeds the confirmed outstanding balance.");
  }
  if (rules.approval_thresholds.amount_minor_supervisor != null
    && (input.requestedAmountMinor ?? 0) >= rules.approval_thresholds.amount_minor_supervisor) {
    required = raise(required, "supervisor");
    signals.push("supervisor_amount_threshold");
    warnings.push("Configured amount threshold requires supervisor approval.");
  }
  if (input.bulk && rules.approval_thresholds.bulk_requires_supervisor) {
    required = raise(required, "supervisor");
    signals.push("bulk_communication");
    warnings.push("Bulk communication requires supervisor approval under this policy.");
  }

  return {
    policy_version_id: policy.id,
    policy_version: policy.version,
    jurisdiction: policy.jurisdiction,
    result: required === "prohibited" ? "prohibited" : required === "automatic" ? "allow" : "approval_required",
    required_approval: required,
    warnings: [...new Set(warnings)],
    signals: [...new Set(signals)],
    sensitive_case_triggers: [...sensitive],
    pauses_automation: sensitive.size > 0,
    evaluated_at: input.now.toISOString(),
    policy_notice: rules.policy_notice,
  };
}

export function approvalSatisfies(required: ComplianceApprovalLevel, approver: ComplianceApprovalLevel) {
  return required !== "prohibited" && approvalRank[approver] >= approvalRank[required];
}
