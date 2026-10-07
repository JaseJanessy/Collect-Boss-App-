import { LoginPage } from "@/components/pages/auth/login-page";
import { redirect } from "next/navigation";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { getServerClient, hasServerAuthCookie } from "@/lib/supabase/server-client";

export const dynamic = "force-dynamic";

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  if (!error && isSupabaseConfigured && await hasServerAuthCookie()) {
    const client = await getServerClient();
    const { data: { user } } = client ? await client.auth.getUser() : { data: { user: null } };
    if (user) redirect("/");
  }
  const initialError = error === "auth_callback_failed"
    ? "This sign-in or confirmation link is invalid or expired. Please try again."
    : "";
  return <LoginPage initialError={initialError} />;
}
