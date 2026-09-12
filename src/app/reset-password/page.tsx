import { cookies } from "next/headers";
import { InvalidRecoveryPage, ResetPasswordPage } from "@/components/pages/auth/reset-password-page";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { getServerClient } from "@/lib/supabase/server-client";

export const dynamic = "force-dynamic";

export default async function ResetPassword() {
  if (!isSupabaseConfigured) return <ResetPasswordPage />;

  const cookieStore = await cookies();
  const hasRecoveryMarker = cookieStore.get("cb-password-recovery")?.value === "1";
  const client = await getServerClient();
  const { data: { user } } = client
    ? await client.auth.getUser()
    : { data: { user: null } };

  return hasRecoveryMarker && user
    ? <ResetPasswordPage />
    : <InvalidRecoveryPage />;
}
