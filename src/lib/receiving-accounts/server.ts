import "server-only";

import { requireTenantPermission } from "@/lib/auth/tenant-access";

export async function requireReceivingAccountOwner(requireStrongConfirmation = false) {
  const access = await requireTenantPermission("receiving_accounts.manage");
  if ("error" in access) return access;
  const { client, service, user, business } = access;

  if (requireStrongConfirmation) {
    const signedInAt = user.last_sign_in_at ? Date.parse(user.last_sign_in_at) : 0;
    if (!signedInAt || Date.now() - signedInAt > 15 * 60_000) {
      return { error: "Sign in again before changing payment destination details.", status: 428 } as const;
    }
    const { data: assurance, error: assuranceError } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assuranceError) return { error: "Unable to verify two-factor authentication state.", status: 503 } as const;
    if (assurance?.nextLevel === "aal2" && assurance.currentLevel !== "aal2") {
      return { error: "Complete your configured two-factor authentication before continuing.", status: 428 } as const;
    }
  }

  return { ...access, client, service, user, business };
}
