// ─── Types ────────────────────────────────────────────────────────────────────

export type EvidenceCategory = "must_have" | "good_to_have";
export type EvidenceFileStatus = "uploaded" | "missing" | "pending";
export type LegalReadinessLevel = "strong" | "fair" | "weak";

export interface EvidenceType {
  id: string;
  name: string;
  description: string;
  category: EvidenceCategory;
  tip: string;
  fileTypes: string[];
  icon: string;
}

export interface UploadedEvidence {
  typeId: string;
  fileName: string;
  fileSize: string;
  uploadedAt: string;
  status: EvidenceFileStatus;
}

export interface AcknowledgementData {
  debtorName: string;
  debtorId: string;
  phone: string;
  caseId: string;
  amountOwed: number;
  paymentDeadline: string;
  otpVerified: boolean;
  signedAt?: string;
}

export interface LawyerPartner {
  id: string;
  name: string;
  firm: string;
  specialisation: string;
  location: string;
  rating: number;
  reviewCount: number;
  feeRange: string;
  languages: string[];
  badge?: string;
}

export interface LegalReadiness {
  score: number;
  level: LegalReadinessLevel;
  evidenceCompleteness: number;
  hasAcknowledgement: boolean;
  hasFormalDemand: boolean;
  daysOverdue: number;
  amountDue: number;
  recommendations: string[];
}

export interface SmallClaimItem {
  id: string;
  label: string;
  description: string;
  status: "done" | "pending" | "not_required";
}

// ─── Evidence type definitions ────────────────────────────────────────────────

export const evidenceTypes: EvidenceType[] = [
  {
    id: "invoice",
    name: "Invoice",
    description: "The billing document for goods or services provided.",
    category: "must_have",
    tip: "Upload the original invoice with your company letterhead, date, and amount clearly shown.",
    fileTypes: ["PDF", "JPG", "PNG"],
    icon: "📄",
  },
  {
    id: "whatsapp",
    name: "WhatsApp / Chat Screenshot",
    description: "Conversation proving the debtor acknowledged the debt.",
    category: "must_have",
    tip: "Screenshot chats where debtor confirmed receiving goods or promised to pay. Include the phone number visible.",
    fileTypes: ["JPG", "PNG"],
    icon: "💬",
  },
  {
    id: "payment_proof",
    name: "Payment Proof",
    description: "Any partial payment receipts already received.",
    category: "must_have",
    tip: "Bank transfer confirmations, DuitNow receipts, or cheque stubs showing the debtor made at least some payment.",
    fileTypes: ["PDF", "JPG", "PNG"],
    icon: "🧾",
  },
  {
    id: "contract",
    name: "Contract / Agreement",
    description: "Signed agreement between you and the debtor.",
    category: "good_to_have",
    tip: "Even a simple WhatsApp agreement or Purchase Order strengthens your case significantly.",
    fileTypes: ["PDF", "JPG", "DOC"],
    icon: "📋",
  },
  {
    id: "delivery_order",
    name: "Delivery Order (DO)",
    description: "Proof that goods were delivered and received.",
    category: "good_to_have",
    tip: "A signed DO proves the debtor received what you supplied. Very important for product-based businesses.",
    fileTypes: ["PDF", "JPG", "PNG"],
    icon: "📦",
  },
  {
    id: "notes",
    name: "Notes / Other Evidence",
    description: "Any additional supporting documents.",
    category: "good_to_have",
    tip: "Photos, emails, or any other evidence showing the business relationship and unpaid amount.",
    fileTypes: ["PDF", "JPG", "PNG", "DOC"],
    icon: "📝",
  },
];

// ─── Per-case uploaded evidence ───────────────────────────────────────────────

export const mockUploadedEvidence: Record<string, UploadedEvidence[]> = {
  "CB-2024-0810": [
    { typeId: "invoice",    fileName: "INV-2025-0428.pdf",     fileSize: "124 KB", uploadedAt: "1 week ago",  status: "uploaded" },
    { typeId: "whatsapp",  fileName: "chat_screenshot.jpg",   fileSize: "892 KB", uploadedAt: "3 days ago", status: "uploaded" },
    { typeId: "payment_proof", fileName: "duitnow_receipt.jpg", fileSize: "344 KB", uploadedAt: "Yesterday", status: "uploaded" },
  ],
  "CB-2024-0901": [
    { typeId: "invoice",        fileName: "INV-2025-0148.pdf",   fileSize: "218 KB", uploadedAt: "2 weeks ago", status: "uploaded" },
    { typeId: "contract",       fileName: "agreement_signed.pdf", fileSize: "1.2 MB", uploadedAt: "1 month ago", status: "uploaded" },
    { typeId: "delivery_order", fileName: "DO-20240401.pdf",     fileSize: "445 KB", uploadedAt: "2 weeks ago", status: "uploaded" },
    { typeId: "payment_proof",  fileName: "partial_payment.jpg", fileSize: "210 KB", uploadedAt: "1 week ago",  status: "uploaded" },
  ],
  "CB-2024-0428": [
    { typeId: "invoice",  fileName: "INV-2024-0821.pdf",  fileSize: "98 KB",  uploadedAt: "2 weeks ago", status: "uploaded" },
    { typeId: "whatsapp", fileName: "chat_aug2024.png",   fileSize: "1.1 MB", uploadedAt: "1 week ago",  status: "uploaded" },
  ],
  "CB-2024-0512": [
    { typeId: "invoice",  fileName: "INV-2024-0512.pdf",  fileSize: "145 KB", uploadedAt: "1 month ago", status: "uploaded" },
  ],
};

// ─── Timeline entries per case ────────────────────────────────────────────────

export interface TimelineEntry {
  date: string;
  event: string;
  type: "invoice" | "reminder" | "payment" | "promise" | "demand" | "call";
}

export const mockCaseTimelines: Record<string, TimelineEntry[]> = {
  "CB-2024-0810": [
    { date: "12 Mar 2024", event: "Invoice INV-2025-0428 issued — RM 18,750",        type: "invoice"  },
    { date: "12 May 2024", event: "Payment due date — no payment received",          type: "invoice"  },
    { date: "14 May 2024", event: "First WhatsApp reminder sent",                    type: "reminder" },
    { date: "17 May 2024", event: "Phone call — customer promised to pay",           type: "call"     },
    { date: "27 May 2024", event: "Payment promise recorded — RM 5,000 by 30 May",  type: "promise"  },
    { date: "30 May 2024", event: "Payment promise not fulfilled",                   type: "reminder" },
    { date: "2 Jun 2026",  event: "Second WhatsApp reminder sent",                  type: "reminder" },
  ],
  "CB-2024-0901": [
    { date: "15 Feb 2024", event: "Contract signed — project agreement",             type: "invoice"  },
    { date: "1 Apr 2024",  event: "Invoice INV-2025-0148 issued — RM 130,420",      type: "invoice"  },
    { date: "1 Apr 2024",  event: "Payment due date — no payment received",          type: "invoice"  },
    { date: "8 Apr 2024",  event: "First email notice sent",                         type: "reminder" },
    { date: "15 Apr 2024", event: "Phone call — customer said will arrange payment", type: "call"     },
    { date: "22 Apr 2024", event: "Second reminder sent",                            type: "reminder" },
    { date: "16 May 2024", event: "Formal demand letter prepared",                   type: "demand"   },
    { date: "2 Jun 2026",  event: "WhatsApp reminder sent today",                   type: "reminder" },
  ],
};

// ─── Debt acknowledgements ────────────────────────────────────────────────────

export const mockAcknowledgements: Record<string, AcknowledgementData> = {
  "CB-2024-0810": {
    debtorName: "Tan Wei Ming",
    debtorId: "901234-10-5678",
    phone: "+60 3-7890 1234",
    caseId: "CB-2024-0810",
    amountOwed: 18750.00,
    paymentDeadline: "30 June 2024",
    otpVerified: true,
    signedAt: undefined,
  },
};

// ─── Lawyer partners ──────────────────────────────────────────────────────────

export const mockLawyerPartners: LawyerPartner[] = [
  {
    id: "law-001",
    name: "Cik Nurul Ain",
    firm: "Nurul Ain & Associates",
    specialisation: "Debt Recovery & Civil Litigation",
    location: "Kuala Lumpur",
    rating: 4.8,
    reviewCount: 124,
    feeRange: "RM 500 – RM 2,000",
    languages: ["Malay", "English"],
    badge: "Top Rated",
  },
  {
    id: "law-002",
    name: "Encik Rajesh Kumar",
    firm: "Kumar & Partners",
    specialisation: "Commercial Law & Debt Recovery",
    location: "Petaling Jaya, Selangor",
    rating: 4.6,
    reviewCount: 87,
    feeRange: "RM 800 – RM 3,000",
    languages: ["English", "Tamil", "Malay"],
  },
  {
    id: "law-003",
    name: "Puan Siti Hajar",
    firm: "Hajar Law Chambers",
    specialisation: "Small Claims & Business Disputes",
    location: "Shah Alam, Selangor",
    rating: 4.7,
    reviewCount: 63,
    feeRange: "RM 300 – RM 1,500",
    languages: ["Malay", "English"],
    badge: "SME Specialist",
  },
];

// ─── Legal readiness helper ───────────────────────────────────────────────────

export function computeLegalReadiness(
  caseId: string,
  amountDue: number,
  daysOverdue: number
): LegalReadiness {
  const uploaded = mockUploadedEvidence[caseId] ?? [];
  const mustHave = evidenceTypes.filter((e) => e.category === "must_have");
  const uploadedIds = new Set(uploaded.map((u) => u.typeId));
  const mustHaveCount = mustHave.filter((e) => uploadedIds.has(e.id)).length;
  const evidenceCompleteness = Math.round((uploadedIds.size / evidenceTypes.length) * 100);
  const hasMustHave = mustHaveCount === mustHave.length;
  const hasAcknowledgement = !!mockAcknowledgements[caseId];
  const hasFormalDemand = daysOverdue >= 30;

  let score = 0;
  if (hasMustHave) score += 40;
  else score += mustHaveCount * 13;
  if (hasAcknowledgement) score += 20;
  if (hasFormalDemand) score += 15;
  if (uploadedIds.has("contract")) score += 15;
  if (uploadedIds.has("delivery_order")) score += 10;
  score = Math.min(100, score);

  const level: LegalReadinessLevel =
    score >= 70 ? "strong" : score >= 40 ? "fair" : "weak";

  const recommendations: string[] = [];
  if (!uploadedIds.has("invoice"))        recommendations.push("Upload your invoice");
  if (!uploadedIds.has("whatsapp"))       recommendations.push("Add chat screenshot showing acknowledgement");
  if (!uploadedIds.has("delivery_order")) recommendations.push("Upload delivery order if applicable");
  if (!hasAcknowledgement)               recommendations.push("Get debtor to sign debt acknowledgement");
  if (!hasFormalDemand && daysOverdue >= 14) recommendations.push("Send a formal demand letter");

  return {
    score,
    level,
    evidenceCompleteness,
    hasAcknowledgement,
    hasFormalDemand,
    daysOverdue,
    amountDue,
    recommendations,
  };
}

// ─── Small claim helpers ──────────────────────────────────────────────────────

export const SMALL_CLAIM_LIMIT = 5000; // RM

export function getSmallClaimItems(
  caseId: string,
  amountDue: number
): SmallClaimItem[] {
  const uploaded = new Set((mockUploadedEvidence[caseId] ?? []).map((u) => u.typeId));
  const hasTimeline = (mockCaseTimelines[caseId] ?? []).length > 0;

  return [
    {
      id: "amount_check",
      label: "Amount below RM 5,000",
      description: `Your claim is RM ${amountDue.toLocaleString("en-MY", { minimumFractionDigits: 2 })} — ${amountDue <= SMALL_CLAIM_LIMIT ? "eligible for Small Claims Court" : "exceeds small claims limit. Consider Magistrate Court."}`,
      status: amountDue <= SMALL_CLAIM_LIMIT ? "done" : "not_required",
    },
    {
      id: "invoice",
      label: "Invoice or proof of debt",
      description: "Original invoice or agreement showing the amount owed.",
      status: uploaded.has("invoice") ? "done" : "pending",
    },
    {
      id: "id_docs",
      label: "Your IC / Company registration",
      description: "Your identification or SSM registration as the claimant.",
      status: "pending",
    },
    {
      id: "debtor_details",
      label: "Debtor contact details",
      description: "Full name, IC number, and address of the debtor.",
      status: "done",
    },
    {
      id: "timeline",
      label: "Case timeline summary",
      description: "A simple timeline of when invoice was issued and reminders sent.",
      status: hasTimeline ? "done" : "pending",
    },
    {
      id: "court_form",
      label: "Claim form (Form 198)",
      description: "Small Claims Court form available at the Magistrate Court.",
      status: "pending",
    },
  ];
}
