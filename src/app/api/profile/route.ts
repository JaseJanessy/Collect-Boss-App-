import { NextRequest, NextResponse } from "next/server";
import type { AccountType } from "@/lib/supabase/types";
import { getServerClient } from "@/lib/supabase/server-client";
import type { BusinessProfileDto } from "@/lib/business-profile/types";
import { businessProfileSchema } from "@/lib/business-profile/validation";

export const dynamic = "force-dynamic";

function toDto(value: {
  id: string;
  account_type: AccountType | null;
  business_name: string;
  legal_name: string | null;
  contact_name: string | null;
  registration_no: string | null;
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
    .select("id, account_type, business_name, legal_name, contact_name, registration_no, phone, email, address, logo_object_path")
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
  const patch = {
    account_type: input.accountType,
    business_name: input.displayName,
    legal_name: input.legalName,
    contact_name: input.contactName,
    registration_no: input.accountType === "individual" ? null : input.registrationNo,
    phone: input.phone,
    email: input.email,
    address: input.address,
  };

  const { data: existing, error: existingError } = await auth.client
    .from("businesses")
    .select("id")
    .eq("owner_id", auth.user.id)
    .maybeSingle();
  if (existingError) return NextResponse.json({ error: "Unable to load profile." }, { status: 500 });

  const query = existing
    ? auth.client.from("businesses").update(patch).eq("id", (existing as { id: string }).id)
    : auth.client.from("businesses").insert({ ...patch, owner_id: auth.user.id });
  const { data, error } = await query
    .select("id, account_type, business_name, legal_name, contact_name, registration_no, phone, email, address, logo_object_path")
    .single();

  if (error || !data) return NextResponse.json({ error: "Unable to save profile." }, { status: 500 });
  return NextResponse.json({ profile: toDto(data as Parameters<typeof toDto>[0]) }, {
    headers: { "Cache-Control": "no-store" },
  });
}
