import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { enforcePublicRateLimit, publicRateLimitResponse } from "@/lib/api/public-rate-limit";
import { paymentSessionCookieName, validatePaymentAccessSession } from "@/lib/payment-access/service";
import { getPublicActionContext } from "@/lib/public-access/service";
import { minorToDecimalString, parseCurrencyToMinor } from "@/lib/financial/money";
import { validatePaymentDate, validatePaymentProof, type ValidatedProof } from "@/lib/public-access/proof-validation";
import { getServiceClient } from "@/lib/supabase/service-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";


function tokenError(state: "invalid" | "expired" | "used" | "unavailable") {
  if (state === "unavailable") {
    return response({ error: "Payment service is temporarily unavailable." }, 503);
  }
  // Do not reveal whether an opaque capability ever existed or was revoked.
  return response({ error: "Payment link is unavailable." }, 404);
}

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  const rateLimit = await enforcePublicRateLimit({ headers: request.headers, rawToken: token, action: "proof", limit: 8, windowSeconds: 300 });
  if (!rateLimit.allowed) return publicRateLimitResponse(rateLimit);
  const access = await getPublicActionContext(token, "payment");
  if (access.state !== "valid") return tokenError(access.state);
  if (access.caseScope.status === "closed" || access.caseScope.status === "paid" || access.caseScope.archived_at) return tokenError("invalid");
  const cookieStore = await cookies();
  const paymentSession = await validatePaymentAccessSession(
    token,
    cookieStore.get(paymentSessionCookieName(token))?.value,
  );
  if (!paymentSession) {
    return response({ error: "Verify your registered email or mobile before submitting payment proof." }, 401);
  }

  const form = await request.formData();
  const amountInput = form.get("amount");
  const paymentMethod = form.get("paymentMethod");
  const paymentDateInput = form.get("paymentDate");
  const referenceNo = form.get("referenceNo");
  const note = form.get("note");
  const idempotencyKey = form.get("idempotencyKey");
  const proof = form.get("proof");

  let amountMinor: bigint;
  try {
    if (typeof amountInput !== "string") throw new Error("invalid");
    amountMinor = parseCurrencyToMinor(amountInput, access.caseScope.currency);
  } catch {
    return response({ error: "Enter a valid payment amount." }, 400);
  }
  if (amountMinor > 100_000_000_000n) return response({ error: "Enter a valid payment amount." }, 400);
  if (typeof paymentMethod !== "string" || ![
    "duitnow_qr", "bank_transfer", "cash", "cheque", "tng_ewallet",
  ].includes(paymentMethod)) {
    return response({ error: "Choose a valid payment method." }, 400);
  }
  if (typeof idempotencyKey !== "string" || !isUuid(idempotencyKey)) {
    return response({ error: "Invalid submission request." }, 400);
  }
  if (!(proof instanceof File) || proof.size === 0) {
    return response({ error: "Attach Payment Proof as a PDF, JPG, or PNG file." }, 400);
  }
  let paymentDate: string;
  let validatedProof: ValidatedProof | null = null;
  try {
    paymentDate = validatePaymentDate(paymentDateInput);
    validatedProof = await validatePaymentProof(proof);
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : "Invalid proof submission." }, 400);
  }
  const normalizedReference = typeof referenceNo === "string" ? referenceNo.trim() : "";
  if (normalizedReference.length > 160 || /[\u0000-\u001f\u007f]/.test(normalizedReference)) return response({ error: "Enter a valid payment reference." }, 400);
  const normalizedNote = typeof note === "string" ? note.trim() : "";
  if (normalizedNote.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalizedNote)) return response({ error: "Enter a valid note." }, 400);

  const client = await getServiceClient();
  if (!client) return tokenError("unavailable");

  const submissionId = crypto.randomUUID();
  const proofObjectPath = `${access.caseScope.id}/${access.token.id}/${submissionId}.${validatedProof.extension}`;
  const { error: uploadError } = await client.storage
    .from("payment-proofs")
    .upload(proofObjectPath, proof, {
      cacheControl: "3600",
      contentType: validatedProof.contentType,
      upsert: false,
    });
  if (uploadError) return response({ error: "Unable to upload the payment proof. Please try again." }, 503);

  const { data: submission, error: insertError } = await client
    .from("public_payment_submissions")
    .insert({
      id: submissionId,
      public_access_token_id: access.token.id,
      payment_access_session_id: paymentSession.id,
      amount: minorToDecimalString(amountMinor, access.caseScope.currency),
      amount_minor: amountMinor.toString(),
      currency: access.caseScope.currency,
      payment_method: paymentMethod,
      payment_date: paymentDate,
      reference_no: normalizedReference || null,
      debtor_note: normalizedNote || null,
      idempotency_key: idempotencyKey,
      proof_object_path: proofObjectPath,
      proof_content_type: validatedProof.contentType,
      proof_size_bytes: validatedProof.bytes.byteLength,
      proof_sha256: validatedProof.sha256,
    })
    .select("id")
    .single();

  if (insertError || !submission) {
    await client.storage.from("payment-proofs").remove([proofObjectPath]);
    // The unique token constraint is the authoritative double-submit guard.
    if (insertError?.code === "23505") {
      const { data: existing } = await client
        .from("public_payment_submissions")
        .select("id")
        .eq("public_access_token_id", access.token.id)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (existing) return response({ submitted: true, alreadySubmitted: true });
      return response({ error: "A proof has already been submitted for this link." }, 409);
    }
    return response({ error: "Unable to save the payment submission." }, 500);
  }

  return response({ submitted: true }, 201);
}
