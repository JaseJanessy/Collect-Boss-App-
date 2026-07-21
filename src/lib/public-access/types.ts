export type PublicAccessState = "valid" | "invalid" | "expired" | "used" | "unavailable";

export interface PublicReceivingAccount {
  bankName: string;
  accountHolderName: string;
  accountNumber: string;
  duitnowId: string | null;
}

export interface PublicPaymentDetails {
  creditor: { name: string; phone: string | null; email: string | null };
  invoiceReference: string | null;
  amountDue: number;
  dueDate: string | null;
  receivingAccount: PublicReceivingAccount | null;
  accessRequired: boolean;
  approvedPayments: Array<{ amountMinor: string; paidAt: string }>;
  proofStatus: "not_submitted" | "pending_review" | "approved" | "rejected";
}

export interface PublicAcknowledgementDetails {
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
