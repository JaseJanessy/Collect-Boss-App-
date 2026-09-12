import { NextRequest, NextResponse } from "next/server";
import type { AccountType } from "@/lib/supabase/types";
import { getServerClient } from "@/lib/supabase/server-client";
import type { BusinessProfileDto } from "@/lib/business-profile/types";
import type { BusinessIndustry, BusinessVerificationState } from "@/lib/business-profile/types";
import { businessProfileSchema, creditLimitPolicySchema } from "@/lib/business-profile/validation";
import { normalizeInternationalPhone } from "@/lib/international/phone";
import { isSupportedCountryCode } from "@/lib/international/registry";

export const dynamic = "force-dynamic";

function toDto(value: {
  id: string;
  account_type: AccountType | null;
  business_name: string;
  legal_name: string | null;
  contact_name: string | null;
  registration_no: string | null;
  industry: BusinessIndustry;
  verification_state: BusinessVerificationState;
  verification_submitted_at: string | null;
  verified_at: string | null;
  verification_public_note: string | null;
  payment_links_restricted_until: string | null;
  credit_limit_enforcement_enabled: boolean;
  phone: string | null;
  email: string | null;
  address: string | null;
  logo_object_path: string | null;
}): BusinessProfileDto {
  return {
    id: value.id,
    accountType: value.account_type,
    displayName: value.business_name,
    legalName: value.legal_name,
    contactName: value.contact_name,
    registrationNo: value.registration_no,
    industry: value.industry,
    verificationState: value.verification_state,
    verificationSubmittedAt: value.verification_submitted_at,
    verifiedAt: value.verified_at,
    verificationPublicNote: value.verification_public_note,
    paymentLinksRestrictedUntil: value.payment_links_restricted_until,
    creditLimitEnforcementEnabled: value.credit_limit_enforcement_enabled,
    phone: value.phone,
    email: value.email,
    address: value.address,
    logoObjectPath: value.logo_object_path,
  };
}

async function getAuthenticatedClient() {
  const client = await getServerClient();
  if (!client) return { error: "Profile service is unavailable." as const };

  const { data: { user } } = await client.auth.getUser();
  if (!user) return { error: "You must be signed in." as const };

  return { client, user };
}

export async function GET() {
  const auth = await getAuthenticatedClient();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.error === "You must be signed in." ? 401 : 503 });
  }

  const { data, error } = await auth.client
    .from("businesses")
    .select("id, account_type, business_name, legal_name, contact_name, registration_no, industry, verification_state, verification_submitted_at, verified_at, verification_public_note, payment_links_restricted_until, credit_limit_enforcement_enabled, phone, email, address, logo_object_path")
    .eq("owner_id", auth.user.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: "Unable to load profile." }, { status: 500 });
  return NextResponse.json({ profile: data ? toDto(data as Parameters<typeof toDto>[0]) : null }, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function PUT(request: NextRequest) {
  const auth = await getAuthenticatedClient();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.error === "You must be signed in." ? 401 : 503 });
  }

  const parsed = businessProfileSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a complete valid profile." }, { status: 400 });
  }

  const input = parsed.data;

  const { data: existing, error: existingError } = await auth.client
    .from("businesses")
    .select("id, country_code")
    .eq("owner_id", auth.user.id)
    .maybeSingle();
  if (existingError) return NextResponse.json({ error: "Unable to load profile." }, { status: 500 });
  const countryCode = isSupportedCountryCode((existing as { country_code?: unknown } | null)?.country_code)
    ? (existing as { country_code: "MY" | "SG" | "GB" | "AU" | "US" }).country_code : "MY";
  const normalizedPhone = normalizeInternationalPhone(input.phone, countryCode);
  const patch = {
    account_type: input.accountType,
    business_name: input.displayName,
    legal_name: input.legalName,
    contact_name: input.contactName,
    registration_no: input.accountType === "individual" ? null : input.registrationNo,
    industry: input.industry,
    phone: normalizedPhone.displayValue,
    phone_e164: normalizedPhone.e164,
    email: input.email,
    address: input.address,
  };

  const query = existing
    ? auth.client.from("businesses").update(patch).eq("id", (existing as { id: string }).id)
    : auth.client.from("businesses").insert({ ...patch, owner_id: auth.user.id });
  const { data, error } = await query
    .select("id, account_type, business_name, legal_name, contact_name, registration_no, industry, verification_state, verification_submitted_at, verified_at, verification_public_note, payment_links_restricted_until, credit_limit_enforcement_enabled, phone, email, address, logo_object_path")
    .single();

  if (error || !data) return NextResponse.json({ error: "Unable to save profile." }, { status: 500 });
  return NextResponse.json({ profile: toDto(data as Parameters<typeof toDto>[0]) }, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function PATCH(request: NextRequest) {
  const auth = await getAuthenticatedClient();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.error === "You must be signed in." ? 401 : 503 });
  }
  const parsed = creditLimitPolicySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid credit-limit policy." }, { status: 400 });

  const { data, error } = await auth.client
    .from("businesses")
    .update({ credit_limit_enforcement_enabled: parsed.data.creditLimitEnforcementEnabled })
    .eq("owner_id", auth.user.id)
    .select("id, account_type, business_name, legal_name, contact_name, registration_no, industry, verification_state, verification_submitted_at, verified_at, verification_public_note, payment_links_restricted_until, credit_limit_enforcement_enabled, phone, email, address, logo_object_path")
    .single();
  if (error || !data) return NextResponse.json({ error: "Unable to update the credit-limit policy." }, { status: 500 });
  return NextResponse.json({ profile: toDto(data as Parameters<typeof toDto>[0]) }, {
    headers: { "Cache-Control": "no-store" },
  });
}
