export interface CasePrioritySummary {
  amounts: {
    verifiedOutstandingMinor: number;
    disputedMinor: number;
    unverifiedProofMinor: number;
    settledOrAdjustedMinor: number;
  };
  balanceVerification: "ledger_verified" | "legacy_unverified";
  receivingAccountVerification: "unverified" | "pending" | "verified" | "rejected" | "disabled" | "not_configured";
  latestPayment: { amountMinor: number; currency: string; createdAt: string } | null;
  openDispute: { disputedMinor: number; status: string; submittedAt: string } | null;
  promise: { promisedMinor: number; fulfilledMinor: number; status: string; promiseDate: string } | null;
  evidenceCount: number;
  pendingProofCount: number;
  nextAction: { label: string; href: string };
  riskFlags: string[];
}
