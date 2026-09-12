import "server-only";

import type { User } from "@supabase/supabase-js";

import {
  readUserRegistration,
  type RegistrationProduct,
  type RegistrationSelection,
} from "@collectboss/registration-contracts";
import type { AppSupabaseClient } from "@/lib/supabase/client";
import { getServiceClient } from "@/lib/supabase/service-client";

export interface RegistrationProvisionResult {
  businessId: string;
  product: RegistrationProduct;
  created: boolean;
}

/**
 * Idempotently creates the minimum tenant record needed to enter CollectBoss.
 * The established profile onboarding remains authoritative for full business data.
 */
export async function provisionRegisteredWorkspace(
  client: AppSupabaseClient,
  user: User,
  trustedSelection?: RegistrationSelection,
): Promise<RegistrationProvisionResult | null> {
  const registration = trustedSelection ?? readUserRegistration(user);
  if (!registration) return null;

  const { data: existing, error: existingError } = await client
    .from("businesses")
    .select("id")
    .eq("owner_id", user.id)
    .maybeSingle();
  if (existingError) throw new Error("Unable to verify the registered workspace.");

  let businessId = (existing as { id: string } | null)?.id ?? null;
  let created = false;

  if (!businessId) {
    const { data: inserted, error: insertError } = await client
      .from("businesses")
      .insert({
        owner_id: user.id,
        business_name: registration.accountName,
        contact_name: registration.fullName,
        phone: registration.phone,
        email: user.email ?? null,
      })
      .select("id")
      .single();

    if (insertError) {
      // A confirmation callback and a signed-in client can race. Re-read the
      // owner-scoped row so that the operation remains safe and idempotent.
      const { data: raced, error: racedError } = await client
        .from("businesses")
        .select("id")
        .eq("owner_id", user.id)
        .maybeSingle();
      businessId = racedError ? null : (raced as { id: string } | null)?.id ?? null;
      if (!businessId) throw new Error("Unable to create the registered workspace.");
    } else {
      businessId = (inserted as { id: string }).id;
      created = true;
    }
  }

  const { data: currentProduct, error: productReadError } = await client
    .from("workspace_product_states")
    .select("product_type")
    .eq("business_id", businessId)
    .maybeSingle();
  if (productReadError) throw new Error("Unable to verify the selected CollectBoss product.");

  const existingProduct = (currentProduct as { product_type: RegistrationProduct } | null)?.product_type;
  if (existingProduct) return { businessId, product: existingProduct, created };

  const service = await getServiceClient();
  if (!service) {
    // A missing row is an intentional Main default. Pocket must fail closed so
    // a new account is never silently routed into the competing Main product.
    if (registration.product === "main") return { businessId, product: "main", created };
    throw new Error("CollectBoss Pocket workspace provisioning is unavailable.");
  }

  const { error: productWriteError } = await service
    .from("workspace_product_states")
    .insert({
      business_id: businessId,
      product_type: registration.product,
      lifecycle_state: "active",
      updated_by: user.id,
    });

  if (productWriteError) {
    const { data: racedProduct, error: racedProductError } = await service
      .from("workspace_product_states")
      .select("product_type")
      .eq("business_id", businessId)
      .maybeSingle();
    const product = (racedProduct as { product_type: RegistrationProduct } | null)?.product_type;
    if (racedProductError || !product) throw new Error("Unable to save the selected CollectBoss product.");
    return { businessId, product, created };
  }

  return { businessId, product: registration.product, created };
}
