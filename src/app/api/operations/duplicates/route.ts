import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantPermission } from "@/lib/auth/tenant-access";
import type { DebtorRow } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

const mergeSchema = z.object({
  source_id: z.string().uuid(),
  target_id: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
  confirmation: z.literal("MERGE"),
});

function identifiers(row: DebtorRow) {
  const registration = row.registration_no?.replace(/[^a-z0-9]/gi, "").toUpperCase();
  const email = row.email?.trim().toLowerCase();
  const phone = row.phone?.replace(/\D/g, "");
  return [
    registration ? `registration:${registration}` : "",
    email ? `email:${email}` : "",
    phone && phone.length >= 7 ? `phone:${phone}` : "",
  ].filter(Boolean);
}

export async function GET() {
  const access = await requireTenantPermission("case.read");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const rows: DebtorRow[] = [];
  for (let from = 0; from < 10_000; from += 1000) {
    const { data, error } = await access.service.from("debtors").select("*")
      .eq("business_id", access.businessId).is("archived_at", null).range(from, from + 999);
    if (error) return NextResponse.json({ error: "Unable to scan duplicate identifiers." }, { status: 503 });
    rows.push(...((data ?? []) as DebtorRow[]));
    if ((data ?? []).length < 1000) break;
  }
  const byIdentifier = new Map<string, DebtorRow[]>();
  rows.forEach((row) => identifiers(row).forEach((identifier) => {
    byIdentifier.set(identifier, [...(byIdentifier.get(identifier) ?? []), row]);
  }));
  const groups = [...byIdentifier.entries()].filter(([, matches]) => matches.length > 1)
    .map(([identifier, matches]) => ({
      identifier,
      customers: matches.map((row) => ({
        id: row.id,
        name: row.business_name ?? row.individual_name ?? "Customer",
        contact_name: row.contact_name,
        registration_no: row.registration_no,
        phone: row.phone,
        email: row.email,
        created_at: row.created_at,
      })),
    }));
  return NextResponse.json({ groups }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: NextRequest) {
  const access = await requireTenantPermission("case.manage");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status });
  const parsed = mergeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || parsed.data.source_id === parsed.data.target_id) {
    return NextResponse.json({ error: "Select distinct customers, enter a reason, and type MERGE." }, { status: 400 });
  }
  const { data, error } = await access.client.rpc("merge_duplicate_debtors", {
    p_business_id: access.businessId,
    p_source_id: parsed.data.source_id,
    p_target_id: parsed.data.target_id,
    p_reason: parsed.data.reason,
  });
  if (error || !data) return NextResponse.json({
    error: error?.code === "PGRST202"
      ? "Controlled merge requires the R16 database migration."
      : error?.message ?? "Merge failed without changing either customer.",
  }, { status: 409 });
  return NextResponse.json({ result: data }, { headers: { "Cache-Control": "no-store" } });
}

