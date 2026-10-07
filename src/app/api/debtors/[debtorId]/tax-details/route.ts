import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantPermission } from "@/lib/auth/tenant-access";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

/** Customer details LHDN needs on an e-Invoice (TIN or IC, address). */
const taxDetailsSchema = z.object({
  tin: z.string().trim().toUpperCase().regex(/^([A-Z]{1,2}\d{8,12})?$/, "Enter the TIN, for example C1234567890 or IG12345678901.").nullable().optional(),
  idScheme: z.enum(["BRN", "NRIC", "PASSPORT", "ARMY"]).nullable().optional(),
  idValue: z.string().trim().max(40).nullable().optional(),
  sstNo: z.string().trim().max(40).nullable().optional(),
  addressLine: z.string().trim().max(300).nullable().optional(),
  city: z.string().trim().max(80).nullable().optional(),
  postcode: z.string().trim().regex(/^(\d{5})?$/, "Postcode must be 5 digits.").nullable().optional(),
  stateCode: z.string().regex(/^(0[1-9]|1[0-7])$/).nullable().optional(),
});

async function ownedCustomer(service: { from: (table: string) => any }, businessId: string, debtorId: string) { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!/^[0-9a-f-]{36}$/i.test(debtorId)) return false;
  const { data } = await service.from("debtors").select("id").eq("id", debtorId).eq("business_id", businessId).maybeSingle();
  return Boolean(data);
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ debtorId: string }> }) {
  const access = await requireTenantPermission("case.read");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status, headers });
  const { debtorId } = await params;
  if (!(await ownedCustomer(access.service, access.businessId, debtorId))) return NextResponse.json({ error: "Customer not found." }, { status: 404, headers });
  const { data, error } = await access.service.from("customer_tax_details").select("*").eq("business_id", access.businessId).eq("customer_id", debtorId).maybeSingle();
  if (error) return NextResponse.json({ error: "We couldn't load the customer's tax details." }, { status: 503, headers });
  return NextResponse.json({ details: data }, { headers });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ debtorId: string }> }) {
  const access = await requireTenantPermission("case.manage");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status, headers });
  const { debtorId } = await params;
  if (!(await ownedCustomer(access.service, access.businessId, debtorId))) return NextResponse.json({ error: "Customer not found." }, { status: 404, headers });
  const parsed = taxDetailsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the tax details." }, { status: 400, headers });
  const v = parsed.data;
  const { error } = await access.service.from("customer_tax_details").upsert({
    business_id: access.businessId, customer_id: debtorId, tin: v.tin || null, id_scheme: v.idScheme ?? null,
    id_value: v.idValue || null, sst_no: v.sstNo || null, address_line: v.addressLine || null, city: v.city || null,
    postcode: v.postcode || null, state_code: v.stateCode ?? null, updated_by: access.user.id, updated_at: new Date().toISOString(),
  }, { onConflict: "business_id,customer_id" });
  if (error) return NextResponse.json({ error: "We couldn't save the tax details. Please try again." }, { status: 500, headers });
  return NextResponse.json({ saved: true }, { headers });
}
