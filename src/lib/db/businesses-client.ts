import { getBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";

const MOCK_BUSINESS_ID = "mock-business-id";

export async function getMyBusinessIdClient(): Promise<string> {
  if (!isSupabaseConfigured) return MOCK_BUSINESS_ID;

  const client = getBrowserClient();
  if (!client) return MOCK_BUSINESS_ID;

  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return MOCK_BUSINESS_ID;

  const { data } = await client
    .from("businesses")
    .select("id")
    .eq("owner_id", user.id)
    .maybeSingle();

  return (data as { id: string } | null)?.id ?? MOCK_BUSINESS_ID;
}
