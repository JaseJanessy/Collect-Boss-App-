/**
 * Interface text in English and Bahasa Malaysia.
 *
 * Add a key to `en` first; `ms` is checked against it at compile time and any
 * key missing from `ms` falls back to English at runtime. Keep Malay plain
 * and business-friendly (bahasa perniagaan harian), not legal or literal.
 */
export const en = {
  // Navigation
  "nav.dashboard": "Dashboard",
  "nav.cases": "Cases",
  "nav.payments": "Payments",
  "nav.action-centre": "Action Centre",
  "nav.reports": "Reports",
  "nav.debtors": "Debtors",
  "nav.documents": "Documents",
  "nav.statements": "Statements",
  "nav.notifications": "Notifications",
  "nav.business-profile": "Business Profile",
  "nav.payment-accounts": "Payment Accounts",
  "nav.team": "Team",
  "nav.billing": "Billing",
  "nav.integrations": "Integrations",
  "nav.settings": "Settings",
  "nav.support": "Help & Support",
  "nav.group.Workspace": "Workspace",
  "nav.group.Account": "Account",
  "nav.group.Support": "Support",
  "shell.signOut": "Sign Out",
  "shell.yourAccount": "Your account",
  "shell.accountPreferences": "Account & preferences",
  "shell.search": "Search customers, cases or invoices",

  // Dashboard and priorities
  "dashboard.today": "Today",
  "dashboard.title": "What needs attention",
  "dashboard.moneyFirst": "Money first",
  "dashboard.topPriorities": "Top priorities",
  "dashboard.mostUrgent": "Most urgent first",
  "dashboard.sorted": "Sorted by how serious each item is, then by due date.",
  "dashboard.totalsFailedTitle": "Your money totals couldn't load",
  "dashboard.totalsFailedBody": "Your priority list above still works. Tap Retry to load the real totals.",
  "common.retry": "Retry",
  "common.tryAgain": "Try again",
  "common.save": "Save",
  "common.cancel": "Cancel",
  "common.loading": "Loading…",
  "common.goToDashboard": "Go to Dashboard",

  // Pages
  "cases.title": "Cases",
  "cases.subtitle": "See which customers need follow-up.",
  "payments.title": "Payments",
  "payments.subtitle": "Track all payments and proof reviews.",
  "settings.title": "Settings",
  "settings.subtitle": "Business, payments and preferences.",
  "settings.appearance": "Appearance",
  "settings.appearanceHint": "Choose how CollectBoss looks on this device. Dark mode is easier on the eyes in long sessions.",
  "settings.language": "Language",
  "settings.languageHint": "Choose the language for menus and screens on this device. Reminder messages follow each customer's language.",
  "theme.light": "Light",
  "theme.dark": "Dark",
  "theme.system": "Same as device",

  // Errors and status
  "error.pageTitle": "This page didn't load",
  "error.pageBody": "Your data is safe. Tap Try again, or go back to your dashboard.",
  "error.retryGeneric": "We couldn't load this right now. Please check your connection and tap Retry.",
  "error.session": "Your session has ended. Please sign in again.",
  "error.rateLimit": "Too many attempts. Please wait a minute and try again.",

  // Auth
  "auth.welcomeBack": "Welcome Back",
  "auth.signInHint": "Sign in to your Main or Pocket workspace.",
  "auth.email": "Email Address",
  "auth.password": "Password",
  "auth.forgotPassword": "Forgot password?",
  "auth.signIn": "Sign In",
  "auth.noAccount": "Don't have an account?",
  "auth.register": "Register here",

  // Product quiz
  "quiz.open": "Not sure? Answer 3 quick questions",
  "quiz.title": "Which one fits my business?",
  "quiz.recommendMain": "We recommend CollectBoss",
  "quiz.recommendPocket": "We recommend CollectBoss Pocket",

  // Onboarding
  "onboarding.importTitle": "Bring in your customers",
  "onboarding.importBody": "Have a list in Excel or CSV? Upload it now and each row becomes a customer with what they owe. You can also do this later from Data operations.",
  "onboarding.skip": "Skip for now",
  "onboarding.viewCustomers": "View my customers",
} as const;

export type MessageKey = keyof typeof en;

export const ms: Partial<Record<MessageKey, string>> = {
  "nav.dashboard": "Papan Pemuka",
  "nav.cases": "Kes",
  "nav.payments": "Bayaran",
  "nav.action-centre": "Pusat Tindakan",
  "nav.reports": "Laporan",
  "nav.debtors": "Penghutang",
  "nav.documents": "Dokumen",
  "nav.statements": "Penyata",
  "nav.notifications": "Notifikasi",
  "nav.business-profile": "Profil Perniagaan",
  "nav.payment-accounts": "Akaun Pembayaran",
  "nav.team": "Pasukan",
  "nav.billing": "Bil & Langganan",
  "nav.integrations": "Integrasi",
  "nav.settings": "Tetapan",
  "nav.support": "Bantuan & Sokongan",
  "nav.group.Workspace": "Ruang Kerja",
  "nav.group.Account": "Akaun",
  "nav.group.Support": "Sokongan",
  "shell.signOut": "Log Keluar",
  "shell.yourAccount": "Akaun anda",
  "shell.accountPreferences": "Akaun & keutamaan",
  "shell.search": "Cari pelanggan, kes atau invois",

  "dashboard.today": "Hari Ini",
  "dashboard.title": "Perlu perhatian",
  "dashboard.moneyFirst": "Ringkasan wang",
  "dashboard.topPriorities": "Keutamaan utama",
  "dashboard.mostUrgent": "Paling mendesak dahulu",
  "dashboard.sorted": "Disusun mengikut tahap keseriusan, kemudian tarikh akhir.",
  "dashboard.totalsFailedTitle": "Jumlah wang anda tidak dapat dimuatkan",
  "dashboard.totalsFailedBody": "Senarai keutamaan di atas masih boleh digunakan. Tekan Cuba Lagi untuk memuatkan jumlah sebenar.",
  "common.retry": "Cuba Lagi",
  "common.tryAgain": "Cuba lagi",
  "common.save": "Simpan",
  "common.cancel": "Batal",
  "common.loading": "Memuatkan…",
  "common.goToDashboard": "Ke Papan Pemuka",

  "cases.title": "Kes",
  "cases.subtitle": "Lihat pelanggan yang perlu disusuli.",
  "payments.title": "Bayaran",
  "payments.subtitle": "Jejak semua bayaran dan semakan bukti bayaran.",
  "settings.title": "Tetapan",
  "settings.subtitle": "Perniagaan, bayaran dan keutamaan.",
  "settings.appearance": "Paparan",
  "settings.appearanceHint": "Pilih rupa CollectBoss pada peranti ini. Mod gelap lebih selesa untuk mata jika digunakan lama.",
  "settings.language": "Bahasa",
  "settings.languageHint": "Pilih bahasa menu dan skrin pada peranti ini. Mesej peringatan mengikut bahasa setiap pelanggan.",
  "theme.light": "Cerah",
  "theme.dark": "Gelap",
  "theme.system": "Ikut peranti",

  "error.pageTitle": "Halaman ini tidak dapat dimuatkan",
  "error.pageBody": "Data anda selamat. Tekan Cuba lagi, atau kembali ke papan pemuka.",
  "error.retryGeneric": "Kami tidak dapat memuatkan ini sekarang. Sila semak sambungan anda dan tekan Cuba Lagi.",
  "error.session": "Sesi anda telah tamat. Sila log masuk semula.",
  "error.rateLimit": "Terlalu banyak cubaan. Sila tunggu seminit dan cuba lagi.",

  "auth.welcomeBack": "Selamat Kembali",
  "auth.signInHint": "Log masuk ke ruang kerja Main atau Pocket anda.",
  "auth.email": "Alamat E-mel",
  "auth.password": "Kata Laluan",
  "auth.forgotPassword": "Lupa kata laluan?",
  "auth.signIn": "Log Masuk",
  "auth.noAccount": "Belum ada akaun?",
  "auth.register": "Daftar di sini",

  "quiz.open": "Tidak pasti? Jawab 3 soalan ringkas",
  "quiz.title": "Mana satu sesuai untuk perniagaan saya?",
  "quiz.recommendMain": "Kami cadangkan CollectBoss",
  "quiz.recommendPocket": "Kami cadangkan CollectBoss Pocket",

  "onboarding.importTitle": "Masukkan senarai pelanggan anda",
  "onboarding.importBody": "Ada senarai dalam Excel atau CSV? Muat naik sekarang dan setiap baris menjadi pelanggan berserta jumlah hutang. Anda juga boleh buat kemudian di Operasi Data.",
  "onboarding.skip": "Langkau dahulu",
  "onboarding.viewCustomers": "Lihat pelanggan saya",
};

export type Locale = "en" | "ms";

export const LOCALE_STORAGE_KEY = "cb-lang";
export const LOCALE_CHANGED_EVENT = "collectboss:locale-changed";

export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "ms";
}

export function translate(locale: Locale, key: MessageKey, vars?: Record<string, string | number>): string {
  const template = (locale === "ms" ? ms[key] : undefined) ?? en[key];
  return vars ? template.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match)) : template;
}

/** Current UI locale outside React (e.g. plain helpers). Defaults to English. */
export function currentLocale(): Locale {
  if (typeof document === "undefined") return "en";
  return document.documentElement.lang.toLowerCase().startsWith("ms") ? "ms" : "en";
}

/** Translated navigation label, falling back to the item's own English label. */
export function navigationLabel(
  t: (key: MessageKey) => string,
  item: { id: string; label: string },
): string {
  const key = `nav.${item.id}`;
  return key in en ? t(key as MessageKey) : item.label;
}

export function navigationGroupLabel(t: (key: MessageKey) => string, group: string): string {
  const key = `nav.group.${group}`;
  return key in en ? t(key as MessageKey) : group;
}
