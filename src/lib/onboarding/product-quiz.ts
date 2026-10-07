export type CustomerVolume = "under_20" | "20_to_100" | "over_100";
export type TeamShape = "just_me" | "with_staff";
export type MainNeed = "quick_tracking" | "formal_process";

export interface ProductQuizAnswers {
  customers: CustomerVolume;
  team: TeamShape;
  need: MainNeed;
}

export interface ProductRecommendation {
  product: "main" | "pocket";
  reasons: string[];
}

export const PRODUCT_QUIZ_QUESTIONS = [
  {
    key: "customers",
    question: "How many customers owe you money right now?",
    options: [
      { value: "under_20", label: "Fewer than 20" },
      { value: "20_to_100", label: "20 to 100" },
      { value: "over_100", label: "More than 100" },
    ],
  },
  {
    key: "team",
    question: "Who will use CollectBoss?",
    options: [
      { value: "just_me", label: "Just me" },
      { value: "with_staff", label: "Me and my staff" },
    ],
  },
  {
    key: "need",
    question: "What do you need most?",
    options: [
      { value: "quick_tracking", label: "Quick tracking on my phone" },
      { value: "formal_process", label: "Formal notices, evidence and reports" },
    ],
  },
] as const;

/**
 * Pocket suits solo owners with a manageable customer list. Staff, a large
 * book of debtors or a need for formal notices points to the full product.
 */
export function recommendProduct(answers: ProductQuizAnswers): ProductRecommendation {
  const reasons: string[] = [];
  if (answers.team === "with_staff") reasons.push("CollectBoss lets staff share the work with their own roles and permissions.");
  if (answers.customers === "over_100") reasons.push("CollectBoss handles a large customer list with bulk import, filters and reports.");
  if (answers.need === "formal_process") reasons.push("CollectBoss includes formal payment notices, evidence exports and reports.");
  if (reasons.length > 0) return { product: "main", reasons };

  return {
    product: "pocket",
    reasons: [
      answers.customers === "20_to_100"
        ? "Pocket keeps a growing customer list simple on your phone. You can upgrade later without losing data."
        : "Pocket is the fastest way to track who owes you and send reminders from your phone.",
    ],
  };
}
