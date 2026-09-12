import { z } from "zod";

const channels = ["whatsapp", "call", "email", "portal", "other"] as const;
const approvalLevels = ["automatic", "agent", "supervisor", "legal", "prohibited"] as const;
const sensitiveCategories = [
  "identity_theft", "paid_in_full_dispute", "legal_representation", "serious_complaint",
  "vulnerability", "bereavement", "wrong_party",
] as const;

const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const phrases = z.array(z.string().trim().min(2).max(300)).max(200);

export const complianceRulesSchema = z.object({
  policy_notice: z.string().trim().min(20).max(1000),
  contact_windows: z.partialRecord(z.enum(channels), z.object({
    start: time,
    end: time,
    days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  })),
  frequency: z.object({
    max_attempts_24h: z.number().int().min(1).max(100),
    max_attempts_7d: z.number().int().min(1).max(500),
    max_attempts_30d: z.number().int().min(1).max(2000),
  }).refine((value) => value.max_attempts_24h <= value.max_attempts_7d && value.max_attempts_7d <= value.max_attempts_30d),
  prohibited_phrases: z.array(z.object({
    id: z.string().regex(/^[a-z0-9_:-]{2,80}$/),
    phrases: phrases.min(1),
    approval: z.enum(approvalLevels),
    warning: z.string().trim().min(3).max(500),
  })).max(200),
  threat_indicators: phrases,
  authority_impersonation_indicators: phrases,
  unsupported_legal_claim_indicators: phrases,
  third_party_disclosure_indicators: phrases,
  sensitive_case_indicators: z.record(z.enum(sensitiveCategories), phrases),
  unverified_balance: z.object({
    block_amount_references: z.boolean(),
    amount_reference_indicators: phrases,
  }),
  approval_thresholds: z.object({
    amount_minor_supervisor: z.number().int().nonnegative().nullable(),
    bulk_requires_supervisor: z.boolean(),
  }),
}).strict();
