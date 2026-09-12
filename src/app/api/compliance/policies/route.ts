import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantPermission, appendSensitiveAudit } from "@/lib/auth/tenant-access";
import { complianceRulesSchema } from "@/lib/compliance/validation";

export const dynamic = "force-dynamic";

const schema = z.object({
  jurisdiction: z.string().trim().min(2).max(32).transform((value) => value.toUpperCase()),
  version: z.string().trim().min(1).max(64),
  status: z.enum(["draft", "counsel_approved"]),
  effective_from: z.iso.datetime(),
  effective_until: z.iso.datetime().nullable().default(null),
  rules: complianceRulesSchema,
  counsel_validated_at: z.iso.datetime().nullable().default(null),
  counsel_validator_name: z.string().trim().min(3).max(200).nullable().default(null),
  counsel_validation_reference: z.string().trim().min(5).max(500).nullable().default(null),
}).superRefine((value, context) => {
  if (value.status === "counsel_approved" && (!value.counsel_validated_at || !value.counsel_validator_name || !value.counsel_validation_reference)) {
    context.addIssue({ code: "custom", path: ["status"], message: "Counsel-approved policies require documented professional validation." });
  }
  if (value.effective_until && new Date(value.effective_until) <= new Date(value.effective_from)) {
    context.addIssue({ code: "custom", path: ["effective_until"], message: "Effective end must follow the start." });
  }
});

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  const access = await requireTenantPermission("case.read");
  if ("error" in access) return json({ error: access.error }, access.status);
  const { data, error } = await access.service.from("compliance_policy_versions").select("*")
    .or(`scope_business_id.is.null,scope_business_id.eq.${access.businessId}`)
    .order("created_at", { ascending: false });
  if (error) return json({ error: "Compliance policies could not be loaded." }, 503);
  return json({
    policies: data ?? [],
    disclaimer: "Policies are configurable operational safeguards, not a guarantee of legal compliance. Jurisdiction-specific versions require documented qualified review before activation.",
  });
}

export async function POST(request: NextRequest) {
  const access = await requireTenantPermission("compliance.policy.manage");
  if ("error" in access) return json({ error: access.error }, access.status);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Enter a valid versioned policy and documented validation details.", issues: parsed.error.issues }, 400);
  const input = parsed.data;
  const { data, error } = await access.service.from("compliance_policy_versions").insert({
    scope_business_id: access.businessId,
    jurisdiction: input.jurisdiction,
    version: input.version,
    status: input.status,
    effective_from: input.effective_from,
    effective_until: input.effective_until,
    rules: input.rules,
    counsel_validated_at: input.counsel_validated_at,
    counsel_validator_name: input.counsel_validator_name,
    counsel_validation_reference: input.counsel_validation_reference,
    created_by: access.user.id,
  }).select("*").single();
  if (error || !data) return json({ error: error?.code === "23505" ? "This policy version already exists." : "Policy version could not be created." }, error?.code === "23505" ? 409 : 503);
  try {
    await appendSensitiveAudit({
      access, request, action: "compliance.policy_version_created", entityType: "compliance_policy_version", entityId: data.id,
      after: { jurisdiction: data.jurisdiction, version: data.version, status: data.status, effective_from: data.effective_from },
      metadata: { counsel_validation_reference: data.counsel_validation_reference },
    });
  } catch {
    await access.service.from("compliance_policy_versions").delete().eq("id", data.id).eq("scope_business_id", access.businessId);
    return json({ error: "Policy auditing failed; the new version was not retained." }, 503);
  }
  return json({ policy: data }, 201);
}
