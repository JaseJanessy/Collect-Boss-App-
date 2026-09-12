import { NextResponse } from "next/server";
import { getAuthenticatedBusiness } from "@/lib/debtors/server";
import { getServiceClient } from "@/lib/supabase/service-client";

export const dynamic = "force-dynamic";

const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, {
  status,
  headers: { "Cache-Control": "no-store" },
});

function optionalText(value: unknown, maximum: number): string | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length <= maximum ? normalized || null : undefined;
}

export async function GET() {
  const auth = await getAuthenticatedBusiness();
  if ("error" in auth) return json({ error: auth.error }, auth.error === "You must be signed in." ? 401 : 503);
  const service = await getServiceClient();
  if (!service) return json({ error: "Verification service is unavailable." }, 503);

  const { data, error } = await service.from("business_verification_reviews")
    .select("id,status,industry_snapshot,risk_level,requires_additional_review,registration_document_reference,licence_document_reference,owner_note,public_decision_reason,submitted_at,reviewed_at")
    .eq("business_id", auth.businessId)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) return json({ error: "Unable to load verification history." }, 500);
  return json({ reviews: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await getAuthenticatedBusiness();
  if ("error" in auth) return json({ error: auth.error }, auth.error === "You must be signed in." ? 401 : 503);
  const body = await request.json().catch(() => null) as {
    registrationDocumentReference?: unknown;
    licenceDocumentReference?: unknown;
    ownerNote?: unknown;
  } | null;
  if (!body) return json({ error: "Enter verification review details." }, 400);
  const registrationReference = optionalText(body.registrationDocumentReference, 500);
  const licenceReference = optionalText(body.licenceDocumentReference, 500);
  const ownerNote = optionalText(body.ownerNote, 1000);
  if (registrationReference === undefined || licenceReference === undefined || ownerNote === undefined) {
    return json({ error: "Verification review details are invalid or too long." }, 400);
  }

  const { data, error } = await auth.client.rpc("business_verification_submit", {
    p_registration_document_reference: registrationReference,
    p_licence_document_reference: licenceReference,
    p_owner_note: ownerNote,
  });
  if (error) {
    const message = /licence reference/i.test(error.message)
      ? "A licence reference is required before this industry can be reviewed."
      : /registration identifier/i.test(error.message)
        ? "Complete the business registration identifier before requesting review."
        : "Unable to submit the verification review.";
    return json({ error: message }, 409);
  }
  return json({ submitted: true, review: data }, 201);
}
