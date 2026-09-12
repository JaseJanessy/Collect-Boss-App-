export type PublicAccessState = "valid" | "invalid" | "expired" | "used" | "unavailable";

export interface PublicReceivingAccount {
  bankName: string;
  paymentMethod: string;
  accountHolderName: string;
  accountNumber: string;
  duitnowId: string | null;
  qrUrl: string | null;
}

export interface PublicPaymentDetails {
  currency: string;
  creditor: {
    name: string;
    phone: string | null;
    email: string | null;
    verificationState: "unverified" | "pending" | "verified" | "rejected" | "restricted";
  };
  invoiceReference: string | null;
  amountDue: number;
  totalOutstanding: number;
  collectableAmount: number;
  dueDate: string | null;
  receivingAccount: PublicReceivingAccount | null;
  accessRequired: boolean;
  approvalRequired: boolean;
  otp: {
    verified: boolean;
    sessionExpiresAt: string | null;
    channels: Array<{
      channel: "email" | "sms";
      maskedDestination: string;
    }>;
  };
  approvedPayments: Array<{ amountMinor: string; paidAt: string }>;
  proofStatus: "not_submitted" | "submitted" | "under_review" | "confirmed" | "rejected" | "more_information_required" | "pending_review" | "approved";
  proofReviewMessage: string | null;
  dispute: {
    active: { status: string; disputedAmountMinor: string; undisputedAmountMinor: string; creditorResponse: string | null } | null;
    options: Array<{ obligationId: string | null; reference: string; balanceMinor: string }>;
  };
  negotiation: {
    active: {
      id: string;
      optionType: "promise_to_pay" | "installment_plan" | "payment_difficulty";
      status: "proposed" | "countered" | "accepted" | "declined" | "withdrawn" | "expired";
      proposedBy: "debtor" | "creditor";
      amountNowMinor: string;
      installmentAmountMinor: string;
      frequency: "weekly" | "monthly";
      startDate: string;
      reason: string | null;
      note: string | null;
      expiresAt: string;
    } | null;
  };
  paymentPlanProgress: {
    status: "active" | "defaulted";
    paidMinor: string;
    totalMinor: string;
    paidInstallments: number;
    installmentCount: number;
    nextInstallment: { sequence: number; dueDate: string; amountMinor: string; paidMinor: string; status: string } | null;
  } | null;
}

export interface PublicAcknowledgementDetails {
  currency: string;
  creditorName: string;
  creditorPhone: string | null;
  creditorEmail: string | null;
  termsVersion: number;
  frequency: "weekly" | "monthly" | "custom";
  totalMinor: string;
  schedule: Array<{ sequence: number; dueDate: string; amountMinor: string }>;
  notes: string | null;
}

export type PublicAccessResolution<T> =
  | { state: "valid"; data: T }
  | { state: Exclude<PublicAccessState, "valid"> };
