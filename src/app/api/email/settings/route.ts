import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { appendSensitiveAudit, requireTenantPermission } from "@/lib/auth/tenant-access";
import { listEmailConfiguration } from "@/lib/email/service";
import { getEmailProvider } from "@/lib/email/provider";

export const dynamic = "force-dynamic";

const identitySchema = z.object({
  from_email: z.email().max(320),
  from_name: z.string().trim().min(1).max(120).refine((value) => !/[<>\r\n]/.test(value)),
  reply_domain: z.string().trim().max(253).refine((value) => !value || /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(value.replace(/^@/, "")), "Enter a valid reply domain.").optional().default(""),
  signature_text: z.string().max(4000).default(""),
});

const templateSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(100),
  subject_template: z.string().trim().min(1).max(300).refine((value) => !/[\r\n]/.test(value)),
  body_template: z.string().min(1).max(20000),
  is_active: z.boolean(),
});

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  const access = await requireTenantPermission("communication.manage");
  if ("error" in access) return response({ error: access.error }, access.status);
  try {
    return response(await listEmailConfiguration(access.service, access.businessId, access.user.id));
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : "Unable to load email configuration." }, 503);
  }
}

export async function PUT(request: NextRequest) {
  const access = await requireTenantPermission("settings.sensitive.manage");
  if ("error" in access) return response({ error: access.error }, access.status);
  const parsed = identitySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return response({ error: "Enter a valid sender identity." }, 400);
  const domain = parsed.data.from_email.split("@")[1].toLowerCase();
  const replyDomain = parsed.data.reply_domain.replace(/^@/, "").toLowerCase() || null;
  let verification: { verified: boolean; reason: string | null };
  try {
    verification = await getEmailProvider("resend").verifyDomain(domain);
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : "Unable to verify sender domain." }, 503);
  }
  const now = new Date().toISOString();
  const record = {
    business_id: access.businessId,
    provider: "resend" as const,
    from_email: parsed.data.from_email.toLowerCase(),
    from_name: parsed.data.from_name,
    reply_domain: replyDomain,
    signature_text: parsed.data.signature_text,
    verification_status: verification.verified ? "verified" as const : "failed" as const,
    verified_at: verification.verified ? now : null,
    last_verification_error: verification.reason,
    configured_by: access.user.id,
    updated_at: now,
  };
  const { data, error } = await access.service.from("email_sender_identities").upsert(record, {
    onConflict: "business_id",
  }).select("*").single();
  if (error || !data) return response({ error: "Unable to save sender identity." }, 503);
  try {
    await appendSensitiveAudit({
      access, request, action: "email.sender_identity_configured", entityType: "email_sender_identity",
      entityId: data.id, after: { from_email: data.from_email, verification_status: data.verification_status },
    });
  } catch (auditError) {
    return response({ identity: data, error: auditError instanceof Error ? auditError.message : "Audit logging failed." }, 503);
  }
  return response({ identity: data });
}

export async function PATCH(request: NextRequest) {
  const access = await requireTenantPermission("settings.sensitive.manage");
  if ("error" in access) return response({ error: access.error }, access.status);
  const parsed = templateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return response({ error: "Enter a valid email template." }, 400);
  const { data, error } = await access.service.from("email_templates").update({
    name: parsed.data.name,
    subject_template: parsed.data.subject_template,
    body_template: parsed.data.body_template,
    is_active: parsed.data.is_active,
    updated_by: access.user.id,
    updated_at: new Date().toISOString(),
  }).eq("id", parsed.data.id).eq("business_id", access.businessId).select("*").maybeSingle();
  if (error) return response({ error: "Unable to update email template." }, 503);
  if (!data) return response({ error: "Email template not found." }, 404);
  return response({ template: data });
}
