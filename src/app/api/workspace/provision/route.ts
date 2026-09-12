import { createClient } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";

import { provisionRegisteredWorkspace } from "@/lib/workspace/registration";
import { getServiceClient } from "@/lib/supabase/service-client";
import {
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
  isSupabaseConfigured,
  type AppSupabaseClient,
} from "@/lib/supabase/client";
import {
  MAIN_RULES_VERSION,
  readRegistrationChoiceRequest,
  registrationMetadata,
  type MainRulesAcceptance,
  type RegistrationSelection,
} from "@collectboss/registration-contracts";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) {
    return NextResponse.json({ error: "A secure registration session is required." }, { status: 401 });
  }
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: "Registration provisioning is unavailable." }, { status: 503 });
  }

  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  }) as AppSupabaseClient;
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) {
    return NextResponse.json({ error: "The registration session is invalid or expired." }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => null) as unknown;
    const choice = body === null ? null : readRegistrationChoiceRequest(body);
    if (body !== null && !choice) {
      return NextResponse.json(
        { error: "Choose a valid CollectBoss product and complete all required registration fields." },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    let trustedSelection: RegistrationSelection | undefined;
    let service: Awaited<ReturnType<typeof getServiceClient>> = null;
    if (choice) {
      service = await getServiceClient();
      if (!service) throw new Error("Secure product selection is unavailable.");
      const acceptedAt = new Date().toISOString();
      const acceptance: MainRulesAcceptance | null = choice.product === "main"
        ? { version: MAIN_RULES_VERSION, acceptedAt }
        : null;
      trustedSelection = {
        fullName: choice.fullName,
        accountName: choice.accountName,
        phone: choice.phone,
        product: choice.product,
        registrationVersion: 2,
        mainRulesAcceptance: acceptance,
      };
    }

    const workspace = await provisionRegisteredWorkspace(client, data.user, trustedSelection);
    if (!workspace) {
      return NextResponse.json({ error: "This account does not contain a valid CollectBoss registration." }, { status: 400 });
    }

    if (trustedSelection && workspace.product !== trustedSelection.product) {
      return NextResponse.json(
        { error: `This account is already connected to ${workspace.product === "main" ? "CollectBoss" : "CollectBoss Pocket"}.` },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }

    if (trustedSelection && service) {
      const acceptance = trustedSelection.mainRulesAcceptance;
      if (acceptance) {
        const { data: existingAcceptance, error: acceptanceReadError } = await service
          .from("audit_logs")
          .select("id")
          .eq("business_id", workspace.businessId)
          .eq("action", "registration.main_rules_accepted")
          .eq("actor_id", data.user.id)
          .limit(1)
          .maybeSingle();
        if (acceptanceReadError) throw new Error("Unable to verify the CollectBoss rules agreement.");
        if (!existingAcceptance) {
          const { error: acceptanceWriteError } = await service.from("audit_logs").insert({
            business_id: workspace.businessId,
            action: "registration.main_rules_accepted",
            actor_type: "owner",
            actor_id: data.user.id,
            metadata: {
              rules_version: acceptance.version,
              accepted_at: acceptance.acceptedAt,
              terms_path: "/terms",
              privacy_path: "/privacy",
              legal_disclaimer_path: "/legal-disclaimer",
              pdpa_path: "/pdpa-consent",
            },
          });
          if (acceptanceWriteError) throw new Error("Unable to record the CollectBoss rules agreement.");
        }
      }

      const metadata = registrationMetadata(trustedSelection, trustedSelection.mainRulesAcceptance);
      const { error: metadataError } = await service.auth.admin.updateUserById(data.user.id, {
        app_metadata: { ...(data.user.app_metadata ?? {}), ...metadata },
        user_metadata: {
          ...(data.user.user_metadata ?? {}),
          name: metadata.name,
          full_name: metadata.full_name,
          business_name: metadata.business_name,
          phone: metadata.phone,
        },
      });
      if (metadataError) throw new Error("Unable to complete the CollectBoss account selection.");
    }

    return NextResponse.json({ workspace }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to provision the registered workspace." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
