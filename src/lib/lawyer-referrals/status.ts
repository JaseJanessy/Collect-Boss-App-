export const REFERRAL_STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  draft: { label: "Preparing", color: "text-gray-600", bg: "bg-gray-50", border: "border-gray-200" },
  ready_for_review: { label: "Preparing", color: "text-blue-700", bg: "bg-blue-50", border: "border-blue-200" },
  handoff_pending: { label: "Preparing", color: "text-amber-700", bg: "bg-amber-50", border: "border-amber-200" },
  handoff_failed: { label: "Handoff Failed", color: "text-red-700", bg: "bg-red-50", border: "border-red-200" },
  submitted: { label: "Submitted", color: "text-amber-700", bg: "bg-amber-50", border: "border-amber-200" },
  under_review: { label: "Under Review", color: "text-purple-700", bg: "bg-purple-50", border: "border-purple-200" },
  additional_documents_requested: { label: "Additional Documents Requested", color: "text-orange-700", bg: "bg-orange-50", border: "border-orange-200" },
  lawyer_contacted: { label: "Under Review", color: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200" },
  accepted: { label: "Accepted", color: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200" },
  declined: { label: "Declined", color: "text-red-700", bg: "bg-red-50", border: "border-red-200" },
  withdrawn: { label: "Withdrawn", color: "text-gray-600", bg: "bg-gray-50", border: "border-gray-200" },
  closed: { label: "Closed", color: "text-gray-500", bg: "bg-gray-50", border: "border-gray-200" },
};
