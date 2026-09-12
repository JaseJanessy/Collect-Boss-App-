export const REGISTRATION_METADATA_VERSION = 2 as const;
export const LEGACY_REGISTRATION_METADATA_VERSION = 1 as const;
export const MAIN_RULES_VERSION = "2026-08-24" as const;

export const MAIN_COLLECTBOSS_RULES = [
  "Use CollectBoss only for lawful debts and records you are authorised to manage.",
  "Keep balances, payments, customer details, evidence and collection status accurate and current.",
  "Do not harass, threaten, mislead or make unsupported legal claims to any customer or debtor.",
  "Respect applicable privacy laws, contact preferences, quiet hours, opt-outs and vulnerability safeguards.",
  "Review important notices, demands, payment instructions and evidence before they are sent or relied upon.",
  "Protect account access and customer data, and allow access only to authorised people.",
  "CollectBoss is operational software, not legal advice; obtain professional advice when required.",
] as const;

export type RegistrationProduct = "main" | "pocket";

export interface RegistrationDetails {
  fullName: string;
  accountName: string;
  phone: string;
  product: RegistrationProduct;
}

export interface MainRulesAcceptance {
  version: typeof MAIN_RULES_VERSION;
  acceptedAt: string;
}

export interface RegistrationSelection extends RegistrationDetails {
  registrationVersion: typeof REGISTRATION_METADATA_VERSION | typeof LEGACY_REGISTRATION_METADATA_VERSION;
  mainRulesAcceptance: MainRulesAcceptance | null;
}

export interface RegistrationMetadata {
  collectboss_registration_version: typeof REGISTRATION_METADATA_VERSION;
  collectboss_product: RegistrationProduct;
  collectboss_main_rules_version?: typeof MAIN_RULES_VERSION;
  collectboss_main_rules_accepted_at?: string;
  name: string;
  full_name: string;
  business_name: string;
  phone: string;
}

export interface RegistrationChoiceRequest extends RegistrationDetails {
  mainRulesAccepted: boolean;
  mainRulesVersion: typeof MAIN_RULES_VERSION;
}

function clean(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function validDetails(value: unknown): RegistrationDetails | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const fullName = typeof candidate.fullName === "string" ? clean(candidate.fullName) : "";
  const accountName = typeof candidate.accountName === "string" ? clean(candidate.accountName) : "";
  const phone = typeof candidate.phone === "string" ? clean(candidate.phone) : "";
  const product = candidate.product;

  if (fullName.length < 2 || fullName.length > 100) return null;
  if (accountName.length < 2 || accountName.length > 120) return null;
  if (phone.length < 7 || phone.length > 30 || !/^[+()\-\s.0-9]+$/u.test(phone)) return null;
  if (product !== "main" && product !== "pocket") return null;
  return { fullName, accountName, phone, product };
}

export function readRegistrationChoiceRequest(value: unknown): RegistrationChoiceRequest | null {
  const details = validDetails(value);
  if (!details || !value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.mainRulesVersion !== MAIN_RULES_VERSION) return null;
  if (details.product === "main" && candidate.mainRulesAccepted !== true) return null;
  if (details.product === "pocket" && typeof candidate.mainRulesAccepted !== "boolean") return null;
  return {
    ...details,
    mainRulesAccepted: candidate.mainRulesAccepted === true,
    mainRulesVersion: MAIN_RULES_VERSION,
  };
}

export function registrationMetadata(
  details: RegistrationDetails,
  mainRulesAcceptance: MainRulesAcceptance | null = null,
): RegistrationMetadata {
  const fullName = clean(details.fullName);
  return {
    collectboss_registration_version: REGISTRATION_METADATA_VERSION,
    collectboss_product: details.product,
    ...(mainRulesAcceptance ? {
      collectboss_main_rules_version: mainRulesAcceptance.version,
      collectboss_main_rules_accepted_at: mainRulesAcceptance.acceptedAt,
    } : {}),
    name: fullName,
    full_name: fullName,
    business_name: clean(details.accountName),
    phone: clean(details.phone),
  };
}

export function readRegistrationMetadata(value: unknown): RegistrationSelection | null {
  if (!value || typeof value !== "object") return null;
  const metadata = value as Record<string, unknown>;
  const version = metadata.collectboss_registration_version;
  if (version !== REGISTRATION_METADATA_VERSION && version !== LEGACY_REGISTRATION_METADATA_VERSION) return null;

  const details = validDetails({
    fullName: metadata.full_name,
    accountName: metadata.business_name,
    phone: metadata.phone,
    product: metadata.collectboss_product,
  });
  if (!details) return null;

  if (version === LEGACY_REGISTRATION_METADATA_VERSION) {
    return { ...details, registrationVersion: version, mainRulesAcceptance: null };
  }

  const rulesVersion = metadata.collectboss_main_rules_version;
  const acceptedAt = metadata.collectboss_main_rules_accepted_at;
  const mainRulesAcceptance = rulesVersion === MAIN_RULES_VERSION
    && typeof acceptedAt === "string"
    && !Number.isNaN(Date.parse(acceptedAt))
    ? { version: MAIN_RULES_VERSION, acceptedAt }
    : null;
  if (details.product === "main" && !mainRulesAcceptance) return null;

  return { ...details, registrationVersion: version, mainRulesAcceptance };
}

export function readUserRegistration(user: {
  app_metadata?: unknown;
  user_metadata?: unknown;
}): RegistrationSelection | null {
  return readRegistrationMetadata(user.app_metadata) ?? readRegistrationMetadata(user.user_metadata);
}
