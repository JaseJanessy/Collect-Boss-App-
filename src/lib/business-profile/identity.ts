import type { BusinessProfileDto } from "./types";

/**
 * Produces the minimum creditor identity safe for document rendering. Legacy
 * profiles retain their existing display name until they are completed.
 */
export function getDocumentCreditorName(profile: BusinessProfileDto | null): string {
  return profile?.legalName?.trim() || profile?.displayName?.trim() || "Creditor";
}
