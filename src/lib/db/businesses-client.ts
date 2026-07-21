import { getBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

const MOCK_BUSINESS_ID = "mock-business-id";

export async function getMyBusinessIdClient(): Promise<string | null> {
  if (!isSupabaseConfigured) return MOCK_BUSINESS_ID;

  const client = getBrowserClient();
  if (!client) return null;

  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return null;

  const { data } = await client
    .from("businesses")
    .select("id")
    .eq("owner_id", user.id)
    .maybeSingle();

  return (data as { id: string } | null)?.id ?? null;
}
