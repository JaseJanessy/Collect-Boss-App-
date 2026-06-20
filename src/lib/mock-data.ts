// ─── Types ────────────────────────────────────────────────────────────────────

export type CaseStatus =
  | "Action Needed"
  | "Payment Promise"
  | "Partial Paid"
  | "Paid"
  | "Overdue"
  | "Formal Demand Ready";

export type ActivityType =
  | "whatsapp"
  | "duitnow"
  | "payment"
  | "promise"
  | "call"
  | "email"
  | "document"
  | "demand";

export type EvidenceStatus = "uploaded" | "missing" | "pending";

export type NextActionType =
  | "reminder"
  | "demand"
  | "plan"
  | "evidence"
  | "call"
  | "payment";

// ─── Core interfaces ──────────────────────────────────────────────────────────

export interface DebtorCase {
  id: string;
  debtorName: string;
  companyRegNo: string;
  phone: string;
  location: string;
  amountDue: number;
  amountPaid: number;
  originalAmount: number;
  dueDate: string;
  invoiceNo: string;
  status: CaseStatus;
  daysOverdue: number;
  bank: string;
  lastAction: string;
  lastActionTime: string;
  notes?: string;
}

export interface Activity {
  id: string;
  type: ActivityType;
  description: string;
  debtorName: string;
  amount?: number;
  time: string;
  caseId: string;
}

export interface EvidenceItem {
  id: string;
  name: string;
  status: EvidenceStatus;
  fileType?: string;
  uploadedAt?: string;
}

export interface NextBestAction {
  actionType: NextActionType;
  title: string;
  description: string;
  successRate?: string;
  ctaLabel: string;
}

// ─── Cases ───────────────────────────────────────────────────────────────────

export const mockCases: DebtorCase[] = [
  {
    id: "CB-2024-0810",
    debtorName: "Maju Elektrik Enterprise",
    companyRegNo: "20180643243",
    phone: "+60 3-7890 1234",
    location: "Kuala Lumpur, Wilayah Persekutuan",
    amountDue: 18750.00,
    amountPaid: 0,
    originalAmount: 18750.00,
    dueDate: "12 May 2024",
    invoiceNo: "INV-2025-0428",
    status: "Overdue",
    daysOverdue: 18,
    bank: "Maybank",
    lastAction: "Payment promise added",
    lastActionTime: "3 days ago",
    notes: "Customer agreed to pay by 30 May. Follow up if no payment by then.",
  },
  {
    id: "CB-2024-0901",
    debtorName: "Alam Bina Sdn Bhd",
    companyRegNo: "20180642430",
    phone: "+60 12-345 0789",
    location: "Kuala Lumpur, Wilayah Persekutuan",
    amountDue: 130420.00,
    amountPaid: 0,
    originalAmount: 130420.00,
    dueDate: "1 Apr 2024",
    invoiceNo: "INV-2025-0148",
    status: "Formal Demand Ready",
    daysOverdue: 45,
    bank: "Maybank",
    lastAction: "Formal demand letter prepared",
    lastActionTime: "Today",
    notes: "High-value case. Engage lawyer if no response within 7 days.",
  },
  {
    id: "CB-2024-0428",
    debtorName: "Kedai Bina Sdn Bhd",
    companyRegNo: "201901043281",
    phone: "+60 12-345 6789",
    location: "Petaling Jaya, Selangor",
    amountDue: 8750.00,
    amountPaid: 0,
    originalAmount: 8750.00,
    dueDate: "15 May 2024",
    invoiceNo: "INV-2024-0821",
    status: "Overdue",
    daysOverdue: 12,
    bank: "Maybank",
    lastAction: "WhatsApp reminder sent",
    lastActionTime: "9:15 AM",
  },
  {
    id: "CB-2024-0512",
    debtorName: "Kencana Maju Trading",
    companyRegNo: "201501765432",
    phone: "+60 3-4567 8901",
    location: "Klang, Selangor",
    amountDue: 12500.00,
    amountPaid: 0,
    originalAmount: 12500.00,
    dueDate: "22 Apr 2024",
    invoiceNo: "INV-2024-0512",
    status: "Action Needed",
    daysOverdue: 24,
    bank: "Hong Leong Bank",
    lastAction: "No response to 3 reminders",
    lastActionTime: "5 days ago",
  },
  {
    id: "CB-2024-0655",
    debtorName: "Syarikat Zulkifli & Rakan",
    companyRegNo: "201601234567",
    phone: "+60 19-876 5432",
    location: "Cheras, Kuala Lumpur",
    amountDue: 6800.00,
    amountPaid: 0,
    originalAmount: 6800.00,
    dueDate: "8 May 2024",
    invoiceNo: "INV-2024-0655",
    status: "Payment Promise",
    daysOverdue: 19,
    bank: "Maybank",
    lastAction: "Promise to pay by 30 May",
    lastActionTime: "3 days ago",
  },
  {
    id: "CB-2024-0821",
    debtorName: "DuitNow Solutions Sdn Bhd",
    companyRegNo: "202001234567",
    phone: "+60 16-788 9012",
    location: "Shah Alam, Selangor",
    amountDue: 5420.00,
    amountPaid: 0,
    originalAmount: 5420.00,
    dueDate: "20 May 2024",
    invoiceNo: "INV-2024-0634",
    status: "Overdue",
    daysOverdue: 7,
    bank: "CIMB",
    lastAction: "DuitNow payment received",
    lastActionTime: "Yesterday",
  },
  {
    id: "CB-2024-0752",
    debtorName: "MR Plaster Ceiling",
    companyRegNo: "201701987654",
    phone: "+60 11-2345 6789",
    location: "Subang Jaya, Selangor",
    amountDue: 2860.00,
    amountPaid: 1500.00,
    originalAmount: 4360.00,
    dueDate: "17 May 2024",
    invoiceNo: "INV-2024-0752",
    status: "Partial Paid",
    daysOverdue: 11,
    bank: "CIMB",
    lastAction: "Partial payment RM 1,500",
    lastActionTime: "Yesterday",
  },
  {
    id: "CB-2024-0803",
    debtorName: "Taman Flora Nursery",
    companyRegNo: "201801123456",
    phone: "+60 14-567 8901",
    location: "Ampang, Selangor",
    amountDue: 0,
    amountPaid: 3200.00,
    originalAmount: 3200.00,
    dueDate: "16 May 2024",
    invoiceNo: "INV-2024-0803",
    status: "Paid",
    daysOverdue: 0,
    bank: "RHB",
    lastAction: "Full payment received",
    lastActionTime: "2 days ago",
  },
];

// ─── Global recent activity feed ─────────────────────────────────────────────

export const mockActivities: Activity[] = [
  {
    id: "act-001",
    type: "whatsapp",
    description: "WhatsApp reminder sent",
    debtorName: "Alam Bina Sdn Bhd",
    time: "9:15 AM",
    caseId: "CB-2024-0901",
  },
  {
    id: "act-002",
    type: "duitnow",
    description: "DuitNow payment received",
    debtorName: "MR Plaster Ceiling",
    amount: 1500.00,
    time: "Yesterday",
    caseId: "CB-2024-0752",
  },
  {
    id: "act-003",
    type: "promise",
    description: "Payment promise added",
    debtorName: "Maju Elektrik Enterprise",
    amount: 5000.00,
    time: "3 days ago",
    caseId: "CB-2024-0810",
  },
  {
    id: "act-004",
    type: "document",
    description: "Invoice uploaded",
    debtorName: "Kencana Maju Trading",
    time: "5 days ago",
    caseId: "CB-2024-0512",
  },
];

// ─── Per-case activity histories ─────────────────────────────────────────────

export const mockCaseActivities: Record<string, Activity[]> = {
  "CB-2024-0810": [
    {
      id: "ca-0810-1",
      type: "promise",
      description: "Payment promise recorded — RM 5,000 by 30 May 2024",
      debtorName: "Maju Elektrik Enterprise",
      amount: 5000,
      time: "3 days ago",
      caseId: "CB-2024-0810",
    },
    {
      id: "ca-0810-2",
      type: "whatsapp",
      description: "WhatsApp reminder sent",
      debtorName: "Maju Elektrik Enterprise",
      time: "5 days ago",
      caseId: "CB-2024-0810",
    },
    {
      id: "ca-0810-3",
      type: "call",
      description: "Phone call — no answer",
      debtorName: "Maju Elektrik Enterprise",
      time: "1 week ago",
      caseId: "CB-2024-0810",
    },
  ],
  "CB-2024-0901": [
    {
      id: "ca-0901-1",
      type: "demand",
      description: "Formal demand letter prepared",
      debtorName: "Alam Bina Sdn Bhd",
      time: "Today",
      caseId: "CB-2024-0901",
    },
    {
      id: "ca-0901-2",
      type: "whatsapp",
      description: "WhatsApp reminder sent",
      debtorName: "Alam Bina Sdn Bhd",
      time: "2 days ago",
      caseId: "CB-2024-0901",
    },
    {
      id: "ca-0901-3",
      type: "email",
      description: "Email notice sent",
      debtorName: "Alam Bina Sdn Bhd",
      time: "1 week ago",
      caseId: "CB-2024-0901",
    },
    {
      id: "ca-0901-4",
      type: "call",
      description: "Phone call — customer promised to arrange payment",
      debtorName: "Alam Bina Sdn Bhd",
      time: "2 weeks ago",
      caseId: "CB-2024-0901",
    },
  ],
  "CB-2024-0428": [
    {
      id: "ca-0428-1",
      type: "whatsapp",
      description: "WhatsApp reminder sent",
      debtorName: "Kedai Bina Sdn Bhd",
      time: "9:15 AM",
      caseId: "CB-2024-0428",
    },
    {
      id: "ca-0428-2",
      type: "call",
      description: "Phone call — spoke to owner, will pay next week",
      debtorName: "Kedai Bina Sdn Bhd",
      time: "3 days ago",
      caseId: "CB-2024-0428",
    },
  ],
  "CB-2024-0752": [
    {
      id: "ca-0752-1",
      type: "payment",
      description: "Partial payment received via DuitNow",
      debtorName: "MR Plaster Ceiling",
      amount: 1500,
      time: "Yesterday",
      caseId: "CB-2024-0752",
    },
    {
      id: "ca-0752-2",
      type: "promise",
      description: "Balance RM 2,860 promised by 31 May",
      debtorName: "MR Plaster Ceiling",
      amount: 2860,
      time: "3 days ago",
      caseId: "CB-2024-0752",
    },
  ],
};

// ─── Per-case evidence ────────────────────────────────────────────────────────

export const mockCaseEvidence: Record<string, EvidenceItem[]> = {
  "CB-2024-0810": [
    { id: "ev1", name: "Invoice INV-2025-0428", status: "uploaded", fileType: "PDF", uploadedAt: "1 week ago" },
    { id: "ev2", name: "Delivery Order", status: "missing" },
    { id: "ev3", name: "Contract / Agreement", status: "missing" },
    { id: "ev4", name: "Payment Promise Letter", status: "pending" },
  ],
  "CB-2024-0901": [
    { id: "ev1", name: "Invoice INV-2025-0148", status: "uploaded", fileType: "PDF", uploadedAt: "2 weeks ago" },
    { id: "ev2", name: "Delivery Order", status: "uploaded", fileType: "PDF", uploadedAt: "2 weeks ago" },
    { id: "ev3", name: "Contract / Agreement", status: "uploaded", fileType: "PDF", uploadedAt: "1 month ago" },
    { id: "ev4", name: "Formal Demand Letter", status: "uploaded", fileType: "PDF", uploadedAt: "Today" },
  ],
  "CB-2024-0428": [
    { id: "ev1", name: "Invoice INV-2024-0821", status: "uploaded", fileType: "PDF", uploadedAt: "2 weeks ago" },
    { id: "ev2", name: "Delivery Order", status: "missing" },
    { id: "ev3", name: "WhatsApp Screenshot", status: "pending" },
  ],
  "CB-2024-0512": [
    { id: "ev1", name: "Invoice INV-2024-0512", status: "uploaded", fileType: "PDF", uploadedAt: "1 month ago" },
    { id: "ev2", name: "Delivery Order", status: "missing" },
    { id: "ev3", name: "Contract / Agreement", status: "missing" },
  ],
};

// ─── Next best actions per case ───────────────────────────────────────────────

export const mockNextBestActions: Record<string, NextBestAction> = {
  "CB-2024-0810": {
    actionType: "reminder",
    title: "Send a friendly reminder",
    description:
      "This debtor usually responds well to friendly reminders. It works in 68% of cases.",
    successRate: "68%",
    ctaLabel: "Send Reminder",
  },
  "CB-2024-0901": {
    actionType: "demand",
    title: "Send formal demand letter",
    description:
      "Formal demand letter is ready to send. This significantly increases legal standing.",
    successRate: "82%",
    ctaLabel: "Send Demand Letter",
  },
  "CB-2024-0428": {
    actionType: "call",
    title: "Follow up with a phone call",
    description:
      "Customer promised to pay next week. Call to confirm arrangement and get exact date.",
    successRate: "54%",
    ctaLabel: "Log Phone Call",
  },
  "CB-2024-0512": {
    actionType: "evidence",
    title: "Prepare evidence pack",
    description:
      "Upload missing delivery order to strengthen your case before sending formal demand.",
    ctaLabel: "Upload Evidence",
  },
  "CB-2024-0655": {
    actionType: "plan",
    title: "Confirm payment promise",
    description:
      "Payment promised by 30 May. Send a gentle WhatsApp to confirm the arrangement.",
    successRate: "61%",
    ctaLabel: "Send Reminder",
  },
  "CB-2024-0752": {
    actionType: "payment",
    title: "Chase remaining balance",
    description:
      "Partial payment received. Follow up for the remaining RM 2,860 balance.",
    ctaLabel: "Send Reminder",
  },
};

// ─── Summary stats ────────────────────────────────────────────────────────────

export const mockStats = {
  totalToCollect: 185450.00,
  recoveredThisMonth: 42380.00,
  recoveredLastMonth: 35900.00,
  followUpToday: 12,
  paymentPromises: 7,
  totalPromiseValue: 18750.00,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function formatRM(amount: number): string {
  return `RM ${amount.toLocaleString("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatRMShort(amount: number): string {
  if (amount >= 1000) {
    return `RM ${(amount / 1000).toFixed(0)}k`;
  }
  return formatRM(amount);
}

export function getStatusColor(status: CaseStatus): string {
  const map: Record<CaseStatus, string> = {
    "Action Needed":     "bg-purple-100 text-purple-700 border-purple-200",
    "Payment Promise":   "bg-amber-100  text-amber-700  border-amber-200",
    "Partial Paid":      "bg-blue-100   text-blue-700   border-blue-200",
    "Paid":              "bg-emerald-100 text-emerald-700 border-emerald-200",
    "Overdue":           "bg-red-100    text-red-700    border-red-200",
    "Formal Demand Ready":"bg-orange-100 text-orange-700 border-orange-200",
  };
  return map[status] ?? "bg-gray-100 text-gray-700";
}

export function getStatusDot(status: CaseStatus): string {
  const map: Record<CaseStatus, string> = {
    "Action Needed":      "bg-purple-500",
    "Payment Promise":    "bg-amber-500",
    "Partial Paid":       "bg-blue-500",
    "Paid":               "bg-emerald-500",
    "Overdue":            "bg-red-500",
    "Formal Demand Ready":"bg-orange-500",
  };
  return map[status] ?? "bg-gray-500";
}

export function getEvidenceCompleteness(items: EvidenceItem[]): number {
  if (!items || items.length === 0) return 0;
  const uploaded = items.filter((i) => i.status === "uploaded").length;
  return Math.round((uploaded / items.length) * 100);
}

export function getInitials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

export function getAvatarColor(name: string): string {
  const colors = [
    "bg-blue-600",
    "bg-purple-600",
    "bg-emerald-700",
    "bg-amber-600",
    "bg-red-600",
    "bg-cyan-700",
    "bg-indigo-600",
  ];
  const idx = name.charCodeAt(0) % colors.length;
  return colors[idx];
}

export function getCaseById(id: string): DebtorCase | undefined {
  return mockCases.find((c) => c.id === id);
}
