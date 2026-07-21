import { NextRequest, NextResponse } from "next/server";
import { getOwnedCaseScope } from "@/lib/public-access/service";
import { getServerClient } from "@/lib/supabase/server-client";
import { getServiceClient } from "@/lib/supabase/service-client";

export const dynamic = "force-dynamic";

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const ownerClient = await getServerClient();
  const { data: { user } } = ownerClient ? await ownerClient.auth.getUser() : { data: { user: null } };
  if (!user) return NextResponse.json({ error: "You must be signed in." }, { status: 401 });

  const { id } = await context.params;
  const service = await getServiceClient();
  if (!service) return NextResponse.json({ error: "Public link service is unavailable." }, { status: 503 });

  const { data: token } = await service
    .from("public_access_tokens")
    .select("id, case_id")
    .eq("id", id)
    .maybeSingle();
  if (!token || !(await getOwnedCaseScope((token as { case_id: string }).case_id, user.id))) {
    return NextResponse.json({ error: "Public link not found." }, { status: 404 });
  }

  const { error } = await service
    .from("public_access_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .is("revoked_at", null);
  if (error) return NextResponse.json({ error: "Unable to revoke public link." }, { status: 500 });

  return NextResponse.json({ revoked: true }, { headers: { "Cache-Control": "no-store" } });
}
