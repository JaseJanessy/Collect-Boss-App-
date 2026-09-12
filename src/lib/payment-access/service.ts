import "server-only";

import { getServiceClient } from "@/lib/supabase/service-client";
import { getPublicActionContext } from "@/lib/public-access/service";
import { clientAddress } from "@/lib/api/request-guard";
import { deliverPaymentOtp, type OtpDeliveryChannel } from "./delivery";
import {
  generateOtpCode,
  generatePaymentSessionToken,
  hashOtpCode,
  hashPaymentSession,
  hashSensitiveValue,
  maskEmail,
  maskPhone,
} from "./otp-crypto";

export interface PaymentOtpChannel {
  channel: OtpDeliveryChannel;
  maskedDestination: string;
}

function otpPepper(): string {
  const value = process.env.PAYMENT_ACCESS_OTP_PEPPER?.trim() ?? "";
  if (value.length < 32) throw new Error("PAYMENT_ACCESS_OTP_PEPPER must contain at least 32 characters.");
  return value;
}

export function paymentSessionCookieName(rawToken: string): string {
  return `cb_pay_${hashPaymentSession(rawToken).slice(0, 16)}`;
}

async function registeredContacts(
  client: Awaited<ReturnType<typeof getServiceClient>>,
  caseId: string,
  businessId: string,
) {
  if (!client) return { email: null, phone: null };
  const { data } = await client.from("cases")
    .select("debtor_id,debtor_email,debtor_phone")
    .eq("id", caseId).eq("business_id", businessId).maybeSingle();
  const row = data as { debtor_id: string | null; debtor_email: string | null; debtor_phone: string | null } | null;
  if (!row) return { email: null, phone: null };
  if (!row.debtor_id) return { email: row.debtor_email, phone: row.debtor_phone };
  const { data: debtor } = await client.from("debtors")
    .select("email,phone").eq("id", row.debtor_id).eq("business_id", businessId).maybeSingle();
  const current = debtor as { email: string | null; phone: string | null } | null;
  return {
    email: current?.email?.trim() || row.debtor_email?.trim() || null,
    phone: current?.phone?.trim() || row.debtor_phone?.trim() || null,
  };
}

export async function getPaymentOtpChannels(rawToken: string): Promise<PaymentOtpChannel[]> {
  const context = await getPublicActionContext(rawToken, "payment");
  if (context.state !== "valid") return [];
  const client = await getServiceClient();
  const contacts = await registeredContacts(client, context.caseScope.id, context.caseScope.business_id);
  return [
    ...(contacts.email ? [{ channel: "email" as const, maskedDestination: maskEmail(contacts.email) }] : []),
    ...(contacts.phone ? [{ channel: "sms" as const, maskedDestination: maskPhone(contacts.phone) }] : []),
  ];
}

export async function requestPaymentOtp(rawToken: string, channel: OtpDeliveryChannel, headers: Headers) {
  const context = await getPublicActionContext(rawToken, "payment");
  if (context.state !== "valid") return { status: "accepted" as const };
  const client = await getServiceClient();
  if (!client) throw new Error("Payment access service is unavailable.");
  const contacts = await registeredContacts(client, context.caseScope.id, context.caseScope.business_id);
  const destination = channel === "email" ? contacts.email : contacts.phone;
  if (!destination) return { status: "accepted" as const };
  const pepper = otpPepper();
  const code = generateOtpCode();
  const ipHash = hashSensitiveValue(clientAddress(headers), pepper);
  const { data: business } = await client.from("businesses")
    .select("business_name,legal_name").eq("id", context.caseScope.business_id).maybeSingle();
  const creditor = business as { business_name: string; legal_name: string | null } | null;
  if (!creditor) throw new Error("Payment access service is unavailable.");
  const { data, error } = await client.rpc("payment_access_issue_otp", {
    p_token_id: context.token.id,
    p_business_id: context.caseScope.business_id,
    p_case_id: context.caseScope.id,
    p_channel: channel,
    p_destination_hash: hashSensitiveValue(destination.toLowerCase(), pepper),
    p_code_hash: hashOtpCode(context.token.id, code, pepper),
    p_ip_hash: ipHash,
  });
  if (error) throw new Error("Unable to create payment access code.");
  const issued = data as {
    status: "issued" | "cooldown" | "rate_limited" | "unavailable";
    challenge_id?: string; retry_after?: number; expires_in?: number; resend_after?: number;
  };
  if (issued.status !== "issued") return issued;
  if (!issued.challenge_id) throw new Error("Unable to create payment access code.");
  try {
    const providerReference = await deliverPaymentOtp({
      channel, destination, code,
      creditorName: creditor.legal_name || creditor.business_name,
      idempotencyKey: `payment-otp/${issued.challenge_id}`,
    });
    await client.rpc("payment_access_mark_otp_delivery", {
      p_challenge_id: issued.challenge_id, p_sent: true, p_provider_reference: providerReference,
    });
  } catch (error) {
    await client.rpc("payment_access_mark_otp_delivery", {
      p_challenge_id: issued.challenge_id, p_sent: false, p_provider_reference: null,
    });
    throw error;
  }
  return {
    status: "sent" as const,
    maskedDestination: channel === "email" ? maskEmail(destination) : maskPhone(destination),
    expiresIn: issued.expires_in ?? 420,
    resendAfter: issued.resend_after ?? 60,
  };
}

export async function verifyPaymentOtp(rawToken: string, code: string, headers: Headers) {
  const context = await getPublicActionContext(rawToken, "payment");
  if (context.state !== "valid") return { status: "invalid" as const };
  const client = await getServiceClient();
  if (!client) throw new Error("Payment access service is unavailable.");
  const pepper = otpPepper();
  const rawSession = generatePaymentSessionToken();
  const { data, error } = await client.rpc("payment_access_verify_otp", {
    p_token_id: context.token.id,
    p_code_hash: hashOtpCode(context.token.id, /^\d{6}$/.test(code) ? code : "invalid", pepper),
    p_session_hash: hashPaymentSession(rawSession),
    p_ip_hash: hashSensitiveValue(clientAddress(headers), pepper),
  });
  if (error) throw new Error("Unable to verify payment access code.");
  const result = data as {
    status: "verified" | "invalid" | "expired" | "locked";
    session_id?: string; expires_in?: number; attempts_remaining?: number;
  };
  return result.status === "verified"
    ? { ...result, rawSession }
    : result;
}

export async function validatePaymentAccessSession(rawToken: string, rawSession?: string | null) {
  if (!rawSession) return null;
  const context = await getPublicActionContext(rawToken, "payment");
  if (context.state !== "valid") return null;
  const client = await getServiceClient();
  if (!client) return null;
  const { data, error } = await client.rpc("payment_access_validate_session", {
    p_token_id: context.token.id,
    p_session_hash: hashPaymentSession(rawSession),
  });
  if (error) return null;
  const result = data as { valid: boolean; session_id?: string; expires_at?: string };
  return result.valid && result.session_id && result.expires_at
    ? { id: result.session_id, expiresAt: result.expires_at }
    : null;
}

export async function reportSuspiciousPaymentRequest(
  rawToken: string,
  category: string,
  details: string,
  headers: Headers,
) {
  const context = await getPublicActionContext(rawToken, "payment");
  if (context.state !== "valid") return false;
  const client = await getServiceClient();
  if (!client) throw new Error("Payment access service is unavailable.");
  const pepper = otpPepper();
  const { error } = await client.rpc("payment_access_report_suspicious", {
    p_token_id: context.token.id,
    p_business_id: context.caseScope.business_id,
    p_case_id: context.caseScope.id,
    p_category: category,
    p_details: details,
    p_ip_hash: hashSensitiveValue(clientAddress(headers), pepper),
  });
  if (error) throw new Error("Unable to submit suspicious request report.");
  return true;
}
