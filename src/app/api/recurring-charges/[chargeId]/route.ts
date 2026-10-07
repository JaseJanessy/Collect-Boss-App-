import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { appendSensitiveAudit, requireTenantPermission } from "@/lib/auth/tenant-access";
import { firstRunDate } from "@/lib/receivables/recurring";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store" };
const updateSchema = z.object({ status: z.enum(["active", "paused", "ended"]) });

/** Pause, resume or end a repeating charge. Already-created invoices are never changed. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ chargeId: string }> }) {
  const access = await requireTenantPermission("case.manage");
  if ("error" in access) return NextResponse.json({ error: access.error }, { status: access.status, headers });
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose pause, resume or end." }, { status: 400, headers });
  const { chargeId } = await params;

  const { data: before, error: readError } = await access.service.from("recurring_charges").select("*")
    .eq("id", chargeId).eq("business_id", access.businessId).maybeSingle();
  if (readError) return NextResponse.json({ error: "We couldn't load that repeating charge. Please try again." }, { status: 503, headers });
  const charge = before as { id: string; status: string; day_of_month: number; next_run_date: string } | null;
  if (!charge) return NextResponse.json({ error: "That repeating charge was not found." }, { status: 404, headers });
  if (charge.status === "ended") return NextResponse.json({ error: "This repeating charge has ended. Create a new one instead." }, { status: 409, headers });

  const update: Record<string, unknown> = { status: parsed.data.status, updated_at: new Date().toISOString() };
  if (parsed.data.status === "active" && charge.status === "paused") {
    // Resuming does not back-bill the paused months.
    const today = new Date().toISOString().slice(0, 10);
    update.next_run_date = charge.next_run_date < today ? firstRunDate(today, charge.day_of_month) : charge.next_run_date;
  }
  const { data, error } = await access.service.from("recurring_charges").update(update)
    .eq("id", chargeId).eq("business_id", access.businessId).select("*").single();
  if (error || !data) return NextResponse.json({ error: "We couldn't update the repeating charge. Please try again." }, { status: 500, headers });

  await appendSensitiveAudit({
    access, request, action: "recurring_charge.status_changed", entityType: "recurring_charge",
    entityId: chargeId, before: { status: charge.status }, after: { status: parsed.data.status },
  });
  return NextResponse.json({ charge: data }, { headers });
}
