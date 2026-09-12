import { formatCurrencyMinor } from "@/lib/financial/money";

export const pocketReminderLanguages = ["en", "ms", "zh"] as const;
export const pocketReminderTemplateKeys = ["gentle", "due_today", "overdue", "partial_balance"] as const;
export const pocketReminderEventTypes = ["due_soon", "due_today", "overdue", "still_overdue", "partial_balance"] as const;

export type PocketReminderLanguage = (typeof pocketReminderLanguages)[number];
export type PocketReminderTemplateKey = (typeof pocketReminderTemplateKeys)[number];
export type PocketReminderEventType = (typeof pocketReminderEventTypes)[number];
export type PocketReminderGroup = "today" | "overdue" | "payments" | "system";

export interface PocketReminderToggles {
  enabled: boolean;
  dueSoon: boolean;
  dueToday: boolean;
  overdue: boolean;
  stillOverdue: boolean;
  partialBalance: boolean;
}

export interface PocketReminderDebtInput {
  debtId: string;
  dueDate: string | null;
  status: string;
  archivedAt: string | null;
  remainingMinor: number;
  currency: string;
  updatedAt: string;
  partialPaymentLocalDates?: readonly string[];
}

export interface PocketReminderCandidate {
  eventType: PocketReminderEventType;
  group: PocketReminderGroup;
  scheduledLocalDate: string;
  sourceKey: string;
  defaultTemplate: PocketReminderTemplateKey;
}

export interface PocketReminderTemplateValues {
  customerName: string;
  remainingMinor: number;
  currency: string;
  dueDate: string | null;
  businessName: string;
  locale?: string;
}

export const defaultPocketReminderToggles: PocketReminderToggles = {
  enabled: true,
  dueSoon: true,
  dueToday: true,
  overdue: true,
  stillOverdue: true,
  partialBalance: false,
};

const templateCopy: Record<PocketReminderLanguage, Record<PocketReminderTemplateKey, string>> = {
  en: {
    gentle: "Hi {customerName}, a gentle reminder that {remainingBalance} is due on {dueDate} to {businessName}. Thank you.",
    due_today: "Hi {customerName}, a friendly reminder that {remainingBalance} is due today to {businessName}. Thank you.",
    overdue: "Hi {customerName}, our records show {remainingBalance} remains outstanding after {dueDate}. Please let {businessName} know if you need to discuss it. Thank you.",
    partial_balance: "Hi {customerName}, thank you for your payment. The remaining balance with {businessName} is {remainingBalance}. Please let us know if you need the details.",
  },
  ms: {
    gentle: "Hai {customerName}, peringatan mesra bahawa {remainingBalance} perlu dibayar pada {dueDate} kepada {businessName}. Terima kasih.",
    due_today: "Hai {customerName}, peringatan mesra bahawa {remainingBalance} perlu dibayar hari ini kepada {businessName}. Terima kasih.",
    overdue: "Hai {customerName}, rekod kami menunjukkan baki {remainingBalance} masih belum dijelaskan selepas {dueDate}. Sila hubungi {businessName} jika anda ingin berbincang. Terima kasih.",
    partial_balance: "Hai {customerName}, terima kasih atas bayaran anda. Baki dengan {businessName} ialah {remainingBalance}. Sila hubungi kami jika anda memerlukan butiran.",
  },
  zh: {
    gentle: "您好，{customerName}。温馨提醒：应付给 {businessName} 的 {remainingBalance} 将于 {dueDate} 到期。谢谢。",
    due_today: "您好，{customerName}。温馨提醒：应付给 {businessName} 的 {remainingBalance} 今天到期。谢谢。",
    overdue: "您好，{customerName}。我们的记录显示，{dueDate} 到期后仍有 {remainingBalance} 未结清。如需商量，请联系 {businessName}。谢谢。",
    partial_balance: "您好，{customerName}。感谢您的付款。目前在 {businessName} 的剩余款项为 {remainingBalance}。如需明细，请联系我们。",
  },
};

function addLocalDays(value: string, days: number) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error("Reminder date is invalid.");
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function isInactive(input: PocketReminderDebtInput) {
  return Boolean(input.archivedAt)
    || input.remainingMinor <= 0
    || ["draft", "void", "written_off", "paid", "cancelled", "settled", "archived"].includes(input.status);
}

export function buildPocketReminderCandidates(
  debt: PocketReminderDebtInput,
  toggles: PocketReminderToggles = defaultPocketReminderToggles,
): PocketReminderCandidate[] {
  if (!toggles.enabled || isInactive(debt)) return [];
  const candidates: PocketReminderCandidate[] = [];
  const add = (eventType: PocketReminderEventType, group: PocketReminderGroup, date: string, defaultTemplate: PocketReminderTemplateKey) => {
    candidates.push({
      eventType,
      group,
      scheduledLocalDate: date,
      sourceKey: `${debt.debtId}:${eventType}:${date}`,
      defaultTemplate,
    });
  };
  if (debt.dueDate) {
    if (toggles.dueSoon) add("due_soon", "today", addLocalDays(debt.dueDate, -1), "gentle");
    if (toggles.dueToday) add("due_today", "today", debt.dueDate, "due_today");
    if (toggles.overdue) add("overdue", "overdue", addLocalDays(debt.dueDate, 1), "overdue");
    if (toggles.stillOverdue) add("still_overdue", "overdue", addLocalDays(debt.dueDate, 7), "overdue");
  }
  if (toggles.partialBalance) {
    for (const date of [...new Set(debt.partialPaymentLocalDates ?? [])]) {
      add("partial_balance", "payments", date, "partial_balance");
    }
  }
  return candidates;
}

function trustedText(value: string, fallback: string) {
  const safe = value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim();
  return safe.slice(0, 160) || fallback;
}

export function normalizeReminderMessage(value: string) {
  return value.normalize("NFKC")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "")
    .replace(/\r\n?/gu, "\n")
    .trim()
    .slice(0, 1_200);
}

function displayDate(value: string | null, language: PocketReminderLanguage, locale?: string) {
  if (!value) return language === "ms" ? "tarikh yang dipersetujui" : language === "zh" ? "约定日期" : "the agreed date";
  const languageLocale = language === "ms" ? "ms-MY" : language === "zh" ? "zh-CN" : locale || "en-MY";
  return new Intl.DateTimeFormat(languageLocale, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" })
    .format(new Date(`${value}T00:00:00.000Z`));
}

export function renderPocketReminderTemplate(
  template: PocketReminderTemplateKey,
  language: PocketReminderLanguage,
  values: PocketReminderTemplateValues,
) {
  const replacements = {
    customerName: trustedText(values.customerName, language === "zh" ? "客户" : language === "ms" ? "pelanggan" : "customer"),
    remainingBalance: formatCurrencyMinor(values.remainingMinor, values.currency, { locale: values.locale, explicitCode: true }),
    dueDate: displayDate(values.dueDate, language, values.locale),
    businessName: trustedText(values.businessName, "the business"),
  };
  return normalizeReminderMessage(templateCopy[language][template].replace(/\{(customerName|remainingBalance|dueDate|businessName)\}/gu, (_match, key: keyof typeof replacements) => replacements[key]));
}

export function whatsappPhone(value: string | null | undefined) {
  const normalized = value?.replace(/[^0-9]/gu, "") ?? "";
  return /^[1-9][0-9]{7,14}$/u.test(normalized) ? normalized : null;
}

export function buildWhatsAppDeepLink(phone: string, message: string) {
  const normalizedPhone = whatsappPhone(phone);
  const normalizedMessage = normalizeReminderMessage(message);
  if (!normalizedPhone) throw new Error("A valid international-format WhatsApp number is required.");
  if (!normalizedMessage) throw new Error("Reminder message is required.");
  return `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(normalizedMessage)}`;
}

export function reminderTemplateForEvent(event: PocketReminderEventType): PocketReminderTemplateKey {
  if (event === "due_today") return "due_today";
  if (event === "overdue" || event === "still_overdue") return "overdue";
  if (event === "partial_balance") return "partial_balance";
  return "gentle";
}

export function reminderGroupForEvent(event: PocketReminderEventType): PocketReminderGroup {
  if (event === "overdue" || event === "still_overdue") return "overdue";
  if (event === "partial_balance") return "payments";
  return "today";
}
