import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedBusiness } from "@/lib/debtors/server";
import { createCustomer, listCustomers } from "@/lib/customers/server-service";
import { CustomerRepositoryError } from "@/lib/customers/repository";
import { debtorWriteSchema } from "@/lib/validations/debtor";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedBusiness();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.error === "You must be signed in." ? 401 : 503 });
  }

  try {
    const debtors = await listCustomers(auth, {
      query: request.nextUrl.searchParams.get("query") ?? "",
      includeArchived: request.nextUrl.searchParams.get("includeArchived") === "true",
    });
    return NextResponse.json({ debtors }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof CustomerRepositoryError) {
      return NextResponse.json({ error: "Unable to load debtors." }, { status: 500 });
    }
    throw error;
  }
}

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedBusiness();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.error === "You must be signed in." ? 401 : 503 });
  }

  const body = await request.json().catch(() => null) as { allowDuplicate?: boolean } | null;
  const parsed = debtorWriteSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Enter valid debtor details." }, { status: 400 });

  try {
    const result = await createCustomer(auth, parsed.data, Boolean(body?.allowDuplicate));
    if (result.kind === "duplicate") {
      return NextResponse.json({ error: "Possible duplicate debtor.", duplicates: result.duplicates }, { status: 409 });
    }
    return NextResponse.json({ debtor: result.customer }, { status: 201 });
  } catch (error) {
    if (error instanceof CustomerRepositoryError) {
      return NextResponse.json({ error: "Unable to create debtor." }, { status: 500 });
    }
    throw error;
  }
}
