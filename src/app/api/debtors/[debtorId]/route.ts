import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedBusiness } from "@/lib/debtors/server";
import { getCustomerDetail, setCustomerArchived, updateCustomer } from "@/lib/customers/server-service";
import { CustomerRepositoryError } from "@/lib/customers/repository";
import { debtorWriteSchema } from "@/lib/validations/debtor";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ debtorId: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const { debtorId } = await context.params;
  const auth = await getAuthenticatedBusiness();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const result = await getCustomerDetail(auth, debtorId);
    if (!result) return NextResponse.json({ error: "Debtor not found." }, { status: 404 });
    return NextResponse.json({ debtor: result.customer, linkedCaseCount: result.linkedCaseCount }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof CustomerRepositoryError) {
      return NextResponse.json({ error: "Debtor not found." }, { status: 404 });
    }
    throw error;
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { debtorId } = await context.params;
  const auth = await getAuthenticatedBusiness();
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await request.json().catch(() => null) as { archived?: boolean } | null;
  try {
    if (body && typeof body.archived === "boolean") {
      const customer = await setCustomerArchived(auth, debtorId, body.archived);
      if (!customer) return NextResponse.json({ error: "Debtor not found." }, { status: 404 });
      return NextResponse.json({ debtor: customer });
    }

    const parsed = debtorWriteSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Enter valid debtor details." }, { status: 400 });
    const customer = await updateCustomer(auth, debtorId, parsed.data);
    if (!customer) return NextResponse.json({ error: "Debtor not found." }, { status: 404 });
    return NextResponse.json({ debtor: customer });
  } catch (error) {
    if (error instanceof CustomerRepositoryError) {
      return NextResponse.json({ error: body && typeof body.archived === "boolean" ? "Unable to update archive status." : "Unable to update debtor." }, { status: 500 });
    }
    throw error;
  }
}
