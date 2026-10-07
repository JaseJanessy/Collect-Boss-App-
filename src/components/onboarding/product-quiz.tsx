"use client";

import { useState } from "react";
import { Building2, Smartphone, Sparkles } from "lucide-react";
import { useT } from "@/contexts/language-context";
import {
  PRODUCT_QUIZ_QUESTIONS,
  recommendProduct,
  type ProductQuizAnswers,
} from "@/lib/onboarding/product-quiz";

type Partial3 = Partial<ProductQuizAnswers>;

/** Three quick questions that recommend CollectBoss (Main) or Pocket. */
export function ProductQuiz({
  onChoose,
  chooseLabel = "Use this",
  defaultOpen = false,
}: {
  onChoose?: (product: "main" | "pocket") => void;
  chooseLabel?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const t = useT();
  const [answers, setAnswers] = useState<Partial3>({});
  const complete = Boolean(answers.customers && answers.team && answers.need);
  const result = complete ? recommendProduct(answers as ProductQuizAnswers) : null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-dashed border-emerald-300 bg-emerald-50/60 px-4 py-2 text-sm font-bold text-emerald-800 hover:bg-emerald-50"
      >
        <Sparkles className="size-4" aria-hidden="true" />{t("quiz.open")}
      </button>
    );
  }

  return (
    <section aria-labelledby="product-quiz-title" className="rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm">
      <h2 id="product-quiz-title" className="flex items-center gap-2 text-base font-black text-[#0D1B3D]">
        <Sparkles className="size-4 text-emerald-700" aria-hidden="true" />{t("quiz.title")}
      </h2>
      <div className="mt-3 flex flex-col gap-4">
        {PRODUCT_QUIZ_QUESTIONS.map((item, index) => (
          <fieldset key={item.key}>
            <legend className="text-sm font-bold text-gray-700">{index + 1}. {item.question}</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {item.options.map((option) => {
                const selected = answers[item.key] === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setAnswers((current) => ({ ...current, [item.key]: option.value }))}
                    className={`min-h-11 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#007A52] ${selected ? "border-[#009966] bg-[#E8F7F2] text-[#0D1B3D]" : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"}`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>

      <div aria-live="polite">
        {result && (
          <div className="mt-4 rounded-xl border border-[#009966] bg-[#E8F7F2] p-4">
            <p className="flex items-center gap-2 text-sm font-black text-[#0D1B3D]">
              {result.product === "main" ? <Building2 className="size-4" aria-hidden="true" /> : <Smartphone className="size-4" aria-hidden="true" />}
              {result.product === "main" ? t("quiz.recommendMain") : t("quiz.recommendPocket")}
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-700">
              {result.reasons.map((reason) => <li key={reason}>{reason}</li>)}
            </ul>
            {onChoose && (
              <button
                type="button"
                onClick={() => onChoose(result.product)}
                className="mt-3 inline-flex min-h-11 items-center rounded-xl bg-[#009966] px-4 py-2 text-sm font-bold text-white hover:bg-[#00B377]"
              >
                {chooseLabel}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
