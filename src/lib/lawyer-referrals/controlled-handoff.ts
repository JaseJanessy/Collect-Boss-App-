export const LAWYER_REFERRAL_CONSENT_VERSION = "lawyer-referral-data-sharing-v1";

export const ACTIVE_REFERRAL_STATUSES = new Set([
  "ready_for_review", "handoff_pending", "handoff_failed", "submitted",
  "under_review", "lawyer_contacted", "accepted",
]);

export function isReferralEligible(input: { archivedAt: string | null; status: string; balance: number }): boolean {
  return !input.archivedAt && input.status !== "closed" && input.balance > 0;
}

export function canWithdrawReferral(status: string): boolean {
  return ["ready_for_review", "handoff_pending", "handoff_failed", "submitted", "under_review", "lawyer_contacted"].includes(status);
}
