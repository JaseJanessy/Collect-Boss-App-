/**
 * Reminder message generator.
 * Bilingual (Malay + English) messages for Malaysian business context.
 * No threats, no harassment, fully compliant with Malaysian consumer protection laws.
 */

import { type CaseRow, type ReceivingAccountRow } from "@/lib/supabase/types";
import { type ReminderStatus } from "@/lib/supabase/types";
import { formatCurrencyMinor } from "@/lib/financial/money";
export { buildEmailLink, buildWhatsAppLink } from "./handoff-links";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReminderType =
  | "friendly"
  | "formal"
  | "final"
  | "promise_followup"
  | "payment_plan";

export const REMINDER_TYPES: Array<{
  id:          ReminderType;
  label:       string;
  emoji:       string;
  description: string;
  tone:        string;
}> = [
  {
    id:          "friendly",
    label:       "Friendly Reminder",
    emoji:       "😊",
    description: "Polite first reminder",
    tone:        "Warm and approachable",
  },
  {
    id:          "formal",
    label:       "Formal Reminder",
    emoji:       "📋",
    description: "Professional follow-up",
    tone:        "Professional and firm",
  },
  {
    id:          "final",
    label:       "Final Reminder",
    emoji:       "⚠️",
    description: "Urgent final notice",
    tone:        "Firm but respectful",
  },
  {
    id:          "promise_followup",
    label:       "Promise Follow Up",
    emoji:       "🤝",
    description: "Follow up on a payment promise",
    tone:        "Polite accountability",
  },
  {
    id:          "payment_plan",
    label:       "Payment Plan",
    emoji:       "📅",
    description: "Instalment plan reminder",
    tone:        "Supportive and cooperative",
  },
];

export const REMINDER_STATUS_LABELS: Record<ReminderStatus, string> = {
  draft:            "Draft",
  copied:           "Copied",
  sent_manually:    "Sent Manually",
  follow_up_needed: "Follow Up Needed",
  pending:          "Pending",
  sent:             "Sent",
  failed:           "Failed",
};

export const REMINDER_STATUS_COLORS: Record<ReminderStatus, string> = {
  draft:            "bg-gray-100 text-gray-600 border-gray-200",
  copied:           "bg-blue-100 text-blue-700 border-blue-200",
  sent_manually:    "bg-emerald-100 text-emerald-700 border-emerald-200",
  follow_up_needed: "bg-amber-100 text-amber-700 border-amber-200",
  pending:          "bg-gray-100 text-gray-600 border-gray-200",
  sent:             "bg-emerald-100 text-emerald-700 border-emerald-200",
  failed:           "bg-red-100 text-red-600 border-red-200",
};

// ─── Payment section builder ──────────────────────────────────────────────────

function buildPaymentSection(
  lockMode: CaseRow["payment_lock_mode"],
  account: ReceivingAccountRow | null,
  currency: string,
): string {
  if (lockMode === "immediate" && account?.currency === currency) {
    const duitnow = account.duitnow_id
      ? `DuitNow ID: ${account.duitnow_id}\n`
      : "";
    return (
      `\nBoleh membayar ke / Payment can be made to:\n` +
      `Bank: ${account.bank_name}\n` +
      `Nama Akaun / Account Name: ${account.account_holder_name}\n` +
      `No. Akaun / Account No: ${account.account_number}\n` +
      duitnow +
      `Sila nyatakan No. Invois sebagai rujukan bayaran.\n` +
      `Please quote the Invoice No. as payment reference.`
    );
  }
  return (
    `\nButiran pembayaran akan diberikan selepas kelulusan.\n` +
    `Payment details will be provided after approval.\n` +
    `Hubungi kami untuk meminta akses / Contact us to request access.`
  );
}

// ─── Main generator ───────────────────────────────────────────────────────────

export interface GenerateParams {
  reminderType:  ReminderType;
  caseData:      CaseRow;
  account:       ReceivingAccountRow | null;
  businessName?: string;
  collectableMinor?: number | bigint;
  disputedPortion?: boolean;
}

export function generateReminderMessage({
  reminderType,
  caseData: c,
  account,
  businessName = "kami / our company",
  collectableMinor,
  disputedPortion = false,
}: GenerateParams): string {
  const name    = c.debtor_company ?? c.debtor_name;
  const amount  = formatCurrencyMinor(collectableMinor ?? c.outstanding_minor, c.currency, { explicitCode: true });
  const ref     = c.invoice_no ? `No. Invois / Invoice No: ${c.invoice_no}\n` : "";
  const payment = buildPaymentSection(c.payment_lock_mode, account, c.currency) + (disputedPortion
    ? `\n\nPeringatan ini hanya merujuk kepada jumlah yang tidak dipertikaikan.\nThis reminder concerns only the undisputed amount.`
    : "");
  const overdue = c.days_overdue > 0
    ? `\nTempoh Tertunggak / Overdue By: ${c.days_overdue} hari / days`
    : "";

  switch (reminderType) {
    case "friendly":
      return [
        `Assalamualaikum / Salam Sejahtera,`,
        ``,
        `Yth. ${name},`,
        ``,
        `Semoga anda dalam keadaan baik. Kami ingin mengingatkan dengan hormat bahawa terdapat baki pembayaran yang belum dijelaskan.`,
        `We hope you are well. We would like to kindly remind you of an outstanding payment balance.`,
        ``,
        `${ref}Jumlah Tertunggak / Amount Due: ${amount}`,
        `Tarikh Akhir / Due Date: ${c.due_date}`,
        payment,
        ``,
        `Sila hubungi kami sekiranya ada pertanyaan atau memerlukan bantuan.`,
        `Please do not hesitate to contact us if you have any questions.`,
        ``,
        `Terima kasih atas perhatian anda. / Thank you for your attention.`,
        ``,
        `Hormat, / Best regards,`,
        businessName,
      ].join("\n");

    case "formal":
      return [
        `NOTIS PEMBAYARAN / PAYMENT NOTICE`,
        ``,
        `Kepada / To: ${name}`,
        ``,
        `Ini adalah notis rasmi berhubung baki pembayaran tertunggak.`,
        `This is a formal notice regarding an outstanding payment balance.`,
        ``,
        `${ref}Jumlah Tertunggak / Outstanding Amount: ${amount}`,
        `Tarikh Akhir / Due Date: ${c.due_date}${overdue}`,
        payment,
        ``,
        `Sila jelaskan pembayaran dalam masa 7 hari dari tarikh notis ini.`,
        `Please settle the payment within 7 days from this notice date.`,
        ``,
        `Sekiranya ada sebarang isu, sila hubungi kami dengan segera.`,
        `If there are any issues, please contact us immediately.`,
        ``,
        `Hormat, / Regards,`,
        businessName,
      ].join("\n");

    case "final":
      return [
        `NOTIS AKHIR / FINAL NOTICE`,
        ``,
        `Kepada / To: ${name}`,
        ``,
        `Ini adalah notis akhir berhubung baki tertunggak anda yang masih belum dijelaskan selepas beberapa notis sebelum ini.`,
        `This is a final notice regarding your outstanding balance which remains unsettled after previous notices.`,
        ``,
        `${ref}Jumlah Tertunggak / Outstanding Amount: ${amount}`,
        `Tarikh Akhir / Due Date: ${c.due_date}${overdue}`,
        payment,
        ``,
        `Sila jelaskan pembayaran dalam masa 3 hari dari tarikh notis ini.`,
        `Please settle the payment within 3 days from this notice.`,
        ``,
        `Kegagalan berbuat demikian mungkin mengakibatkan tindakan lanjut diambil.`,
        `Failure to do so may result in further action being taken.`,
        ``,
        `Hubungi kami segera untuk menyelesaikan perkara ini secara aman.`,
        `Please contact us immediately to resolve this matter amicably.`,
        ``,
        `Hormat, / Regards,`,
        businessName,
      ].join("\n");

    case "promise_followup":
      return [
        `Assalamualaikum / Salam Sejahtera,`,
        ``,
        `Yth. ${name},`,
        ``,
        `Kami merujuk kepada janji pembayaran yang telah dibuat sebelum ini. Kami ingin menghubungi anda untuk tindak lanjut.`,
        `We are following up on the payment promise that was previously made.`,
        ``,
        `${ref}Jumlah / Amount: ${amount}`,
        `Tarikh Yang Dijanjikan / Promised By: ${c.due_date}`,
        payment,
        ``,
        `Adakah anda memerlukan bantuan untuk memproses pembayaran ini?`,
        `Do you require any assistance in processing this payment?`,
        ``,
        `Kami sedia membantu. Sila hubungi kami jika ada sebarang halangan.`,
        `We are here to help. Please contact us if there are any obstacles.`,
        ``,
        `Terima kasih. / Thank you.`,
        ``,
        `Hormat, / Best regards,`,
        businessName,
      ].join("\n");

    case "payment_plan":
      return [
        `Assalamualaikum / Salam Sejahtera,`,
        ``,
        `Yth. ${name},`,
        ``,
        `Ini adalah peringatan tentang ansuran pembayaran yang dijadualkan mengikut pelan yang telah dipersetujui.`,
        `This is a reminder regarding your scheduled instalment payment as per the agreed plan.`,
        ``,
        `${ref}Jumlah Perlu Dibayar / Amount Due This Period: ${amount}`,
        `Tarikh Bayaran / Payment Date: ${c.due_date}`,
        payment,
        ``,
        `Sila pastikan bayaran diproses mengikut jadual untuk mengelakkan sebarang isu.`,
        `Please ensure payment is processed as scheduled to avoid any issues.`,
        ``,
        `Kami menghargai usaha anda untuk menyelesaikan baki ini. Terima kasih.`,
        `We appreciate your effort to settle this balance. Thank you.`,
        ``,
        `Hormat, / Best regards,`,
        businessName,
      ].join("\n");

    default:
      return "";
  }
}

// ─── WhatsApp link builder ────────────────────────────────────────────────────

// ─── Frequency check ──────────────────────────────────────────────────────────

export function checkReminderFrequency(reminders: Array<{ sent_at: string; status?: ReminderStatus }>): {
  tooFrequent: boolean;
  recentCount: number;
  warningMessage: string;
} {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recent = reminders.filter((r) =>
    (r.status === undefined || r.status === "sent" || r.status === "sent_manually") &&
    new Date(r.sent_at) > sevenDaysAgo
  );
  const tooFrequent = recent.length >= 3;
  return {
    tooFrequent,
    recentCount: recent.length,
    warningMessage: tooFrequent
      ? `You have sent ${recent.length} reminder${recent.length > 1 ? "s" : ""} in the last 7 days. Allow time for the debtor to respond before sending more to avoid harassment.`
      : "",
  };
}
