import type { BusinessIndustry, BusinessVerificationState } from "./types";

export function industryNeedsAdditionalReview(industry: BusinessIndustry): boolean {
  return industry === "financial_services" || industry === "financing_money_lending";
}

export function isCollectBossVerified(state: BusinessVerificationState): boolean {
  return state === "verified";
}

export function verificationDisplayLabel(state: BusinessVerificationState): string {
  if (isCollectBossVerified(state)) return "Verified after CollectBoss review";
  return state.replace("_", " ").replace(/^\w/, (letter) => letter.toUpperCase());
}
