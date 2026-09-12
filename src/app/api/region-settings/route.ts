import { NextRequest, NextResponse } from "next/server";
import { appendSensitiveAudit, requireTenantPermission } from "@/lib/auth/tenant-access";
import { emptyStructuredAddress } from "@/lib/international/address";
import { normalizeInternationalPhone } from "@/lib/international/phone";
import { resolveRegionSettings } from "@/lib/international/registry";
import type { BusinessRegistrationIdentifier, RegionConfigurationDto, StructuredAddress } from "@/lib/international/types";
import { businessRegistrationIdentifierSchema, regionSettingsUpdateSchema, structuredAddressSchema } from "@/lib/international/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const select = "country_code, locale, timezone, default_currency, date_format, number_format, language_code, address_details, phone, phone_e164, registration_identifiers, region_defaults_source, region_defaults_determined_at";

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

function configuration(row: Record<string, unknown>, canManage: boolean): RegionConfigurationDto {
  const settings = resolveRegionSettings(row);
  const addressResult = structuredAddressSchema.safeParse(row.address_details);
  const identifiersResult = businessRegistrationIdentifierSchema.array().safeParse(row.registration_identifiers);
  return {
    settings,
    address: addressResult.success ? addressResult.data : emptyStructuredAddress(settings.countryCode),
    phoneDisplay: typeof row.phone === "string" ? row.phone : null,
    phoneE164: typeof row.phone_e164 === "string" ? row.phone_e164 : null,
    registrationIdentifiers: identifiersResult.success ? identifiersResult.data : [],
    defaultsSource: typeof row.region_defaults_source === "string" ? row.region_defaults_source : "legacy_malaysia_v1",
    defaultsDeterminedAt: typeof row.region_defaults_determined_at === "string" ? row.region_defaults_determined_at : new Date(0).toISOString(),
    canManage,
  };
}

export async function GET() {
  const access = await requireTenantPermission("case.read");
  if ("error" in access) return response({ error: access.error }, access.status);
  const { data, error } = await access.service.from("businesses").select(select).eq("id", access.businessId).maybeSingle();
  if (error || !data) return response({ error: "Unable to load business region settings." }, 500);
  return response({ configuration: configuration(data as Record<string, unknown>, access.role === "owner" || access.role === "admin") });
}

export async function PATCH(request: NextRequest) {
  const access = await requireTenantPermission("settings.sensitive.manage");
  if ("error" in access) return response({ error: access.error }, access.status);
  const parsed = regionSettingsUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return response({ error: parsed.error.issues[0]?.message ?? "Enter valid region settings." }, 400);

  const { data: before, error: beforeError } = await access.service.from("businesses").select(select).eq("id", access.businessId).maybeSingle();
  if (beforeError || !before) return response({ error: "Unable to load business region settings." }, 500);
  const input = parsed.data;
  const phone = normalizeInternationalPhone(input.phoneDisplay, input.countryCode);
  const patch = {
    country_code: input.countryCode,
    locale: input.locale,
    timezone: input.timezone,
    default_currency: input.defaultCurrency,
    date_format: input.dateFormat,
    number_format: input.numberFormat,
    language_code: input.languageCode,
    address_details: input.address as StructuredAddress,
    phone: phone.displayValue || null,
    phone_e164: phone.e164,
    registration_identifiers: input.registrationIdentifiers as BusinessRegistrationIdentifier[],
    region_defaults_source: "owner_admin_explicit",
    region_defaults_determined_at: new Date().toISOString(),
  };
  const { data, error } = await access.service.from("businesses").update(patch).eq("id", access.businessId).select(select).single();
  if (error || !data) return response({ error: "Unable to save business region settings." }, 500);

  try {
    await appendSensitiveAudit({
      access, request, action: "business.region_settings_updated", entityType: "business", entityId: access.businessId,
      before: before as Record<string, unknown>, after: data as Record<string, unknown>,
    });
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : "Region settings saved but audit logging failed." }, 500);
  }
  return response({ configuration: configuration(data as Record<string, unknown>, true) });
}
