export const documentIntakeStatuses = [
  "draft",
  "awaiting_upload",
  "uploaded",
  "processing",
  "needs_review",
  "ready_to_submit",
  "submitted",
  "failed",
  "cancelled",
] as const;

export type DocumentIntakeStatus = (typeof documentIntakeStatuses)[number];

const transitions: Record<DocumentIntakeStatus, ReadonlySet<DocumentIntakeStatus>> = {
  draft: new Set(["awaiting_upload", "cancelled"]),
  awaiting_upload: new Set(["uploaded", "failed", "cancelled"]),
  uploaded: new Set(["awaiting_upload", "processing", "needs_review", "ready_to_submit", "failed", "cancelled"]),
  processing: new Set(["awaiting_upload", "needs_review", "ready_to_submit", "failed", "cancelled"]),
  needs_review: new Set(["awaiting_upload", "processing", "ready_to_submit", "cancelled"]),
  ready_to_submit: new Set(["awaiting_upload", "needs_review", "submitted", "cancelled"]),
  failed: new Set(["awaiting_upload", "processing", "cancelled"]),
  submitted: new Set(),
  cancelled: new Set(),
};

export function canTransitionDocumentIntake(from: DocumentIntakeStatus, to: DocumentIntakeStatus): boolean {
  return from === to || transitions[from].has(to);
}
