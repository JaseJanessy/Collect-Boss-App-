// ─── Types ────────────────────────────────────────────────────────────────────

export type PaymentAccessRule = "immediate" | "approval" | "manual";
export type PaymentProofStatus = "pending_review" | "approved" | "rejected" | "not_uploaded";
export type PaymentMethod = "DuitNow QR" | "Bank Transfer" | "Cash" | "Cheque" | "TNG eWallet";
export type ApprovalType = "once" | "24h" | "manual";
export type RequestStatus = "pending" | "approved" | "rejected";

export interface ReceivingAccount {
  id: string;
  bankName: string;
  accountHolder: string;
  accountNumber: string;
  duitnowId: string;
  includeInReminder: boolean;
  isPrimary: boolean;
}

export interface PaymentAccessSettings {
  caseId: string;
  rule: PaymentAccessRule;
  requireOtpBeforeRequest: boolean;
  manualProofRequired: boolean;
  autoHideAfter24h: boolean;
  oneTimeAccessOnly: boolean;
  referenceFormat: string;
}

export interface PaymentRequest {
  id: string;
  caseId: string;
  debtorName: string;
  phone: string;
  amount: number;
  requestedAt: string;
  preferredMethod: string;
  reason: string;
  status: RequestStatus;
  approvalType?: ApprovalType;
  approvedAt?: string;
  expiresAt?: string;
  otpVerified: boolean;
}

export interface PaymentRecord {
  id: string;
  caseId: string;
  debtorName: string;
  amount: number;
  method: PaymentMethod;
  reference: string;
  recordedAt: string;
  proofUploaded: boolean;
  proofStatus: PaymentProofStatus;
  notes?: string;
}

// ─── Receiving accounts ───────────────────────────────────────────────────────

export const mockReceivingAccounts: ReceivingAccount[] = [
  {
    id: "acct-001",
    bankName: "Maybank Berhad",
    accountHolder: "CollectBoss Sdn. Bhd.",
    accountNumber: "5148 3120 1234",
    duitnowId: "123456789012",
    includeInReminder: true,
    isPrimary: true,
  },
  {
    id: "acct-002",
    bankName: "CIMB Bank",
    accountHolder: "CollectBoss Sdn. Bhd.",
    accountNumber: "8603 4521 0987",
    duitnowId: "987654321098",
    includeInReminder: false,
    isPrimary: false,
  },
];

export const mockPrimaryAccount = mockReceivingAccounts[0];

// ─── Payment access settings (global default + per-case overrides) ────────────

export const mockDefaultAccessSettings: PaymentAccessSettings = {
  caseId: "default",
  rule: "approval",
  requireOtpBeforeRequest: true,
  manualProofRequired: true,
  autoHideAfter24h: true,
  oneTimeAccessOnly: false,
  referenceFormat: "CB-[CASE_ID]",
};

export const mockCaseAccessSettings: Record<string, PaymentAccessSettings> = {
  "CB-2024-0810": {
    caseId: "CB-2024-0810",
    rule: "approval",
    requireOtpBeforeRequest: true,
    manualProofRequired: true,
    autoHideAfter24h: true,
    oneTimeAccessOnly: false,
    referenceFormat: "CB-2024-0810",
  },
  "CB-2024-0901": {
    caseId: "CB-2024-0901",
    rule: "manual",
    requireOtpBeforeRequest: true,
    manualProofRequired: true,
    autoHideAfter24h: true,
    oneTimeAccessOnly: true,
    referenceFormat: "CB-2024-0901",
  },
  "CB-2024-0428": {
    caseId: "CB-2024-0428",
    rule: "immediate",
    requireOtpBeforeRequest: false,
    manualProofRequired: true,
    autoHideAfter24h: false,
    oneTimeAccessOnly: false,
    referenceFormat: "CB-2024-0428",
  },
};

// ─── Payment access requests ──────────────────────────────────────────────────

export const mockPaymentRequests: PaymentRequest[] = [
  {
    id: "req-001",
    caseId: "CB-2025-0428",
    debtorName: "Encik Farid",
    phone: "+60 12-345 6789",
    amount: 18750.00,
    requestedAt: "9:15 AM",
    preferredMethod: "DuitNow QR + Bank Transfer",
    reason: "Ready to pay outstanding invoice",
    status: "pending",
    otpVerified: true,
  },
  {
    id: "req-002",
    caseId: "CB-2024-0810",
    debtorName: "Tan Wei Ming",
    phone: "+60 16-788 9012",
    amount: 18750.00,
    requestedAt: "Yesterday, 3:42 PM",
    preferredMethod: "Bank Transfer",
    reason: "Will make payment today",
    status: "approved",
    approvalType: "24h",
    approvedAt: "Yesterday, 4:05 PM",
    expiresAt: "Today, 4:05 PM",
    otpVerified: true,
  },
  {
    id: "req-003",
    caseId: "CB-2024-0512",
    debtorName: "Syarikat Kencana Rep",
    phone: "+60 3-4567 8901",
    amount: 12500.00,
    requestedAt: "2 days ago",
    preferredMethod: "DuitNow QR",
    reason: "Partial payment arrangement",
    status: "rejected",
    otpVerified: false,
  },
  {
    id: "req-004",
    caseId: "CB-2024-0655",
    debtorName: "Zulkifli bin Ahmad",
    phone: "+60 19-876 5432",
    amount: 6800.00,
    requestedAt: "2 hours ago",
    preferredMethod: "Bank Transfer",
    reason: "Settling full amount",
    status: "pending",
    otpVerified: true,
  },
  {
    id: "req-005",
    caseId: "CB-2024-0821",
    debtorName: "DuitNow Solutions Rep",
    phone: "+60 16-788 0012",
    amount: 5420.00,
    requestedAt: "1 hour ago",
    preferredMethod: "DuitNow QR",
    reason: "Ready to pay",
    status: "pending",
    otpVerified: true,
  },
];

// ─── Payment records ──────────────────────────────────────────────────────────

export const mockPaymentRecords: PaymentRecord[] = [
  {
    id: "pmt-001",
    caseId: "CB-2024-0752",
    debtorName: "MR Plaster Ceiling",
    amount: 1500.00,
    method: "DuitNow QR",
    reference: "CB-2024-0752",
    recordedAt: "Yesterday, 2:30 PM",
    proofUploaded: true,
    proofStatus: "approved",
    notes: "Partial payment. Balance RM 2,860 due 31 May.",
  },
  {
    id: "pmt-002",
    caseId: "CB-2024-0803",
    debtorName: "Taman Flora Nursery",
    amount: 3200.00,
    method: "Bank Transfer",
    reference: "CB-2024-0803",
    recordedAt: "2 days ago, 10:15 AM",
    proofUploaded: true,
    proofStatus: "approved",
    notes: "Full settlement received.",
  },
  {
    id: "pmt-003",
    caseId: "CB-2024-0810",
    debtorName: "Maju Elektrik Enterprise",
    amount: 5000.00,
    method: "Bank Transfer",
    reference: "CB-2024-0810",
    recordedAt: "Today, 9:00 AM",
    proofUploaded: true,
    proofStatus: "pending_review",
    notes: "Partial payment per promise.",
  },
  {
    id: "pmt-004",
    caseId: "CB-2024-0428",
    debtorName: "Kedai Bina Sdn Bhd",
    amount: 2000.00,
    method: "Cash",
    reference: "CB-2024-0428",
    recordedAt: "3 days ago",
    proofUploaded: false,
    proofStatus: "not_uploaded",
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function generatePaymentRef(caseId: string): string {
  return caseId;
}

export function getAccessRuleLabel(rule: PaymentAccessRule): string {
  const map: Record<PaymentAccessRule, string> = {
    immediate: "Show Payment Details Immediately",
    approval: "Require Approval Before Showing",
    manual: "Locked — Send Manually Only",
  };
  return map[rule];
}

export function getAccessRuleDescription(rule: PaymentAccessRule): string {
  const map: Record<PaymentAccessRule, string> = {
    immediate: "Debtors can view payment details right away.",
    approval: "You approve each request before details are shown.",
    manual: "You send payment details manually to each debtor.",
  };
  return map[rule];
}

export function getProofStatusConfig(status: PaymentProofStatus): {
  label: string;
  color: string;
  bg: string;
} {
  const map: Record<PaymentProofStatus, { label: string; color: string; bg: string }> = {
    pending_review: { label: "Pending Review", color: "text-amber-700",  bg: "bg-amber-50 border-amber-200" },
    approved:       { label: "Approved",        color: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200" },
    rejected:       { label: "Rejected",         color: "text-red-700",    bg: "bg-red-50 border-red-200" },
    not_uploaded:   { label: "No Proof",         color: "text-gray-500",   bg: "bg-gray-50 border-gray-200" },
  };
  return map[status];
}

export function getRequestStatusConfig(status: RequestStatus): {
  label: string;
  color: string;
  dot: string;
} {
  const map: Record<RequestStatus, { label: string; color: string; dot: string }> = {
    pending:  { label: "Pending",  color: "text-amber-700",   dot: "bg-amber-400" },
    approved: { label: "Approved", color: "text-emerald-700", dot: "bg-emerald-500" },
    rejected: { label: "Rejected", color: "text-red-700",     dot: "bg-red-400" },
  };
  return map[status];
}

export function getPaymentStats() {
  const pending  = mockPaymentRequests.filter((r) => r.status === "pending").length;
  const approved = mockPaymentRequests.filter((r) => r.status === "approved").length;
  const rejected = mockPaymentRequests.filter((r) => r.status === "rejected").length;
  return { pending, approved, rejected, avgApprovalTime: "14m" };
}
