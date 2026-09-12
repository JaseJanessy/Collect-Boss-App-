export interface ObligationFinancialInput {
  id: string;
  accountId: string | null;
  originalAmountMinor: number;
  adjustmentsMinor: number;
  paidMinor: number;
  archived?: boolean;
  excluded?: boolean;
}

export interface RecoveryCaseFinancialInput {
  id: string;
  accountId: string | null;
  scope: "standalone" | "single_obligation" | "multiple_obligations" | "account_balance";
  contractualDueMinor: number;
  approvedPaymentMinor: number;
  outstandingMinor: number;
  archived?: boolean;
}

export interface ReceivableTotals {
  contractualDueMinor: number;
  paidMinor: number;
  outstandingMinor: number;
}

export type CreditLimitWarning =
  | "no_limit" | "within_limit" | "approaching_limit" | "limit_reached" | "over_limit";

export interface CreditLimitSnapshot {
  currentExposureMinor: number;
  availableCreditMinor: number | null;
  utilizationPercentage: number | null;
  warning: CreditLimitWarning;
}

export function obligationBalance(input: Pick<ObligationFinancialInput, "originalAmountMinor" | "adjustmentsMinor" | "paidMinor">): ReceivableTotals {
  const contractualDueMinor = input.originalAmountMinor + input.adjustmentsMinor;
  if (!Number.isSafeInteger(contractualDueMinor) || contractualDueMinor < 0) throw new Error("Invalid obligation total.");
  if (!Number.isSafeInteger(input.paidMinor) || input.paidMinor < 0 || input.paidMinor > contractualDueMinor) throw new Error("Invalid obligation payment.");
  return {
    contractualDueMinor,
    paidMinor: input.paidMinor,
    outstandingMinor: contractualDueMinor - input.paidMinor,
  };
}

export function allocateCasePaymentsFifo(
  obligations: ObligationFinancialInput[],
  approvedPaymentMinor: number,
): Map<string, number> {
  if (!Number.isSafeInteger(approvedPaymentMinor) || approvedPaymentMinor < 0) throw new Error("Invalid approved payment.");
  let remaining = approvedPaymentMinor;
  return new Map(obligations.map((obligation) => {
    const due = obligationBalance({ ...obligation, paidMinor: 0 }).contractualDueMinor;
    const allocated = Math.min(due, remaining);
    remaining -= allocated;
    return [obligation.id, allocated];
  }));
}

export function calculateCanonicalCustomerTotals(
  obligations: ObligationFinancialInput[],
  cases: RecoveryCaseFinancialInput[],
): ReceivableTotals {
  const activeObligations = obligations.filter((item) => !item.archived && !item.excluded);
  const accountsWithObligations = new Set(activeObligations.flatMap((item) => item.accountId ? [item.accountId] : []));
  const obligationTotals = activeObligations.map(obligationBalance);
  const standaloneCases = cases.filter((item) =>
    !item.archived
    && (item.scope === "standalone" || item.scope === "account_balance")
    && !(item.scope === "account_balance" && item.accountId && accountsWithObligations.has(item.accountId))
  );
  return [...obligationTotals, ...standaloneCases.map((item) => ({
    contractualDueMinor: item.contractualDueMinor,
    paidMinor: item.approvedPaymentMinor,
    outstandingMinor: item.outstandingMinor,
  }))].reduce<ReceivableTotals>((sum, item) => ({
    contractualDueMinor: sum.contractualDueMinor + item.contractualDueMinor,
    paidMinor: sum.paidMinor + item.paidMinor,
    outstandingMinor: sum.outstandingMinor + item.outstandingMinor,
  }), { contractualDueMinor: 0, paidMinor: 0, outstandingMinor: 0 });
}

export function calculateAccountRollForward(
  obligations: ObligationFinancialInput[],
  accountId: string,
): ReceivableTotals {
  return obligations
    .filter((item) => item.accountId === accountId && !item.archived && !item.excluded)
    .map(obligationBalance)
    .reduce<ReceivableTotals>((sum, item) => ({
      contractualDueMinor: sum.contractualDueMinor + item.contractualDueMinor,
      paidMinor: sum.paidMinor + item.paidMinor,
      outstandingMinor: sum.outstandingMinor + item.outstandingMinor,
    }), { contractualDueMinor: 0, paidMinor: 0, outstandingMinor: 0 });
}

export function calculateCreditLimitSnapshot(
  currentExposureMinor: number,
  creditLimitMinor: number | null,
  warningThresholdPercent = 80,
): CreditLimitSnapshot {
  if (!Number.isSafeInteger(currentExposureMinor) || currentExposureMinor < 0) {
    throw new Error("Invalid current exposure.");
  }
  if (creditLimitMinor === null) {
    return {
      currentExposureMinor,
      availableCreditMinor: null,
      utilizationPercentage: null,
      warning: "no_limit",
    };
  }
  if (!Number.isSafeInteger(creditLimitMinor) || creditLimitMinor <= 0) {
    throw new Error("Invalid credit limit.");
  }
  if (!Number.isFinite(warningThresholdPercent) || warningThresholdPercent <= 0 || warningThresholdPercent > 100) {
    throw new Error("Invalid credit warning threshold.");
  }

  const utilizationPercentage = Math.round((currentExposureMinor * 10_000) / creditLimitMinor) / 100;
  const warning: CreditLimitWarning = currentExposureMinor > creditLimitMinor
    ? "over_limit"
    : currentExposureMinor === creditLimitMinor
      ? "limit_reached"
      : utilizationPercentage >= warningThresholdPercent
        ? "approaching_limit"
        : "within_limit";
  return {
    currentExposureMinor,
    availableCreditMinor: creditLimitMinor - currentExposureMinor,
    utilizationPercentage,
    warning,
  };
}

export function reconcileCoveredCase(
  caseFinancials: RecoveryCaseFinancialInput,
  obligations: ObligationFinancialInput[],
) {
  const totals = obligations.map(obligationBalance).reduce<ReceivableTotals>((sum, item) => ({
    contractualDueMinor: sum.contractualDueMinor + item.contractualDueMinor,
    paidMinor: sum.paidMinor + item.paidMinor,
    outstandingMinor: sum.outstandingMinor + item.outstandingMinor,
  }), { contractualDueMinor: 0, paidMinor: 0, outstandingMinor: 0 });
  return {
    ...totals,
    reconciled:
      totals.contractualDueMinor === caseFinancials.contractualDueMinor
      && totals.paidMinor === Math.min(caseFinancials.approvedPaymentMinor, totals.contractualDueMinor)
      && totals.outstandingMinor === caseFinancials.outstandingMinor,
  };
}
