import "server-only";

import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { getServerClient } from "@/lib/supabase/server-client";
import { getServiceClient } from "@/lib/supabase/service-client";
import { roleHasPermission, type RoleSettings, type TenantPermission, type TenantRole } from "./permissions";
import type { RegionSettingsRecord } from "@/lib/international/types";

const defaultSettings: RoleSettings = {
  manager_can_approve_settlements: false,
  manager_can_approve_write_offs: false,
  manager_can_submit_document_intakes: false,
};

export async function requireTenantPermission(permission: TenantPermission) {
  const client = await getServerClient();
  if (!client) return { error: "Tenant access service is unavailable.", status: 503 } as const;
  const { data: { user } } = await client.auth.getUser();
  if (!user) return { error: "You must be signed in.", status: 401 } as const;
  const service = await getServiceClient();
  if (!service) return { error: "Tenant access service is unavailable.", status: 503 } as const;

  // Older production projects have the original businesses shape but do not
  // yet contain the later regional columns. Read the shared columns first so
  // an authenticated owner can still enter the real workspace while those
  // additive migrations are being applied.
  const { data: owned, error: ownedError } = await service.from("businesses").select("id, owner_id, business_name, legal_name, contact_name, phone, email, address")
    .eq("owner_id", user.id).maybeSingle();
  if (ownedError) return { error: "Workspace access could not be verified. Please retry or contact support.", status: 503 } as const;
  type TenantBusiness = { id: string; business_name: string; legal_name: string | null } & RegionSettingsRecord;
  let business: TenantBusiness | null = owned ? {
    ...owned,
    country_code: "MY",
    locale: "en-MY",
    timezone: "Asia/Kuala_Lumpur",
    default_currency: "MYR",
    date_format: "dd/MM/yyyy",
    number_format: "1,234.56",
    language_code: "en",
  } as TenantBusiness : null;
  let role: TenantRole = "owner";
  if (!business) {
    const { error: invitationError } = await client.rpc("accept_my_business_invitation");
    if (invitationError) return { error: "Workspace membership service is unavailable.", status: 503 } as const;
    const { data: membership, error: membershipError } = await service.from("business_memberships")
      .select("business_id, role").eq("user_id", user.id).eq("status", "active").maybeSingle();
    if (membershipError) return { error: "Workspace membership service is unavailable.", status: 503 } as const;
    if (!membership) return { error: "A business membership is required.", status: 403 } as const;
    role = membership.role as TenantRole;
    const { data, error: businessError } = await service.from("businesses").select("id, owner_id, business_name, legal_name, contact_name, phone, email, address")
      .eq("id", membership.business_id).maybeSingle();
    if (businessError) return { error: "Workspace access is unavailable.", status: 503 } as const;
    business = data ? {
      ...data,
      country_code: "MY",
      locale: "en-MY",
      timezone: "Asia/Kuala_Lumpur",
      default_currency: "MYR",
      date_format: "dd/MM/yyyy",
      number_format: "1,234.56",
      language_code: "en",
    } as TenantBusiness : null;
  }
  if (!business) return { error: "A business membership is required.", status: 403 } as const;
  const { data: configured, error: settingsError } = await service.from("business_role_settings").select("*")
    .eq("business_id", business.id).maybeSingle();
  if (settingsError) {
    // The role-settings table is additive. An owner remains the owner until
    // that table is present; permissions are still evaluated by role.
    if (role !== "owner") return { error: "Workspace permissions are unavailable.", status: 503 } as const;
  }
  const settings: RoleSettings = configured ? {
    manager_can_approve_settlements: Boolean(configured.manager_can_approve_settlements),
    manager_can_approve_write_offs: Boolean(configured.manager_can_approve_write_offs),
    manager_can_submit_document_intakes: Boolean(configured.manager_can_submit_document_intakes),
  } : defaultSettings;
  if (!roleHasPermission(role, permission, settings)) {
    return { error: "You do not have permission to perform this action.", status: 403 } as const;
  }
  return { client, service, user, business, businessId: business.id, role, settings };
}

function digest(value: string | null) {
  return value ? createHash("sha256").update(value).digest("hex") : null;
}

export async function appendSensitiveAudit(input: {
  access: Awaited<ReturnType<typeof requireTenantPermission>>;
  request?: NextRequest;
  action: string;
  entityType: string;
  entityId?: string | null;
  caseId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
}) {
  if ("error" in input.access) return;
  const requestId = input.request?.headers.get("x-request-id") ?? crypto.randomUUID();
  const sessionId = input.request?.headers.get("x-session-id");
  const forwarded = input.request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = input.request?.headers.get("user-agent") ?? null;
  const { error } = await input.access.service.from("audit_logs").insert({
    business_id: input.access.businessId,
    case_id: input.caseId ?? null,
    action: input.action,
    actor_type: "staff",
    actor_id: input.access.user.id,
    actor_role: input.access.role,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    before_summary: input.before ?? null,
    after_summary: input.after ?? null,
    request_id: requestId,
    session_id: sessionId,
    request_metadata: { ip_hash: digest(forwarded), user_agent_hash: digest(userAgent) },
    metadata: input.metadata ?? {},
  });
  if (error) throw new Error(`Sensitive action completed but audit logging failed: ${error.message}`);
}
