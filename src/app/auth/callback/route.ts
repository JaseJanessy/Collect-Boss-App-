import { type NextRequest, NextResponse } from "next/server";
import { isSupabaseConfigured, SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/supabase/client";
import { provisionRegisteredWorkspace } from "@/lib/workspace/registration";

/** Only permit an absolute internal path after an auth redirect. */
function safeNextPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/";
  }
  return value;
}

const RECOVERY_COOKIE = "cb-password-recovery";

/**
 * Supabase Auth callback handler.
 * Called after email confirmation, password reset, and magic link clicks.
 * Exchanges the `code` in the URL for a session.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code  = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));

  if (!isSupabaseConfigured || !code) {
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
  }

  try {
    const { createServerClient } = await import("@supabase/ssr");
    const { cookies } = await import("next/headers");
    const cookieStore = await cookies();

    let response = NextResponse.redirect(`${origin}${next}`);

    const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            cookieStore.set(name, value)
          );
          response = NextResponse.redirect(`${origin}${next}`);
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    });

    let recoveryVerified = false;
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") recoveryVerified = true;
    });
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    listener.subscription.unsubscribe();
    if (error || !data.user) {
      return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
    }

    if (next === "/reset-password") {
      // Supabase derives PASSWORD_RECOVERY from the PKCE verifier. A normal
      // confirmation code with an edited `next` query is not recovery proof.
      if (!recoveryVerified) return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
      response.cookies.set(RECOVERY_COOKIE, "1", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        path: "/",
        maxAge: 10 * 60,
      });
      return response;
    }

    try {
      await provisionRegisteredWorkspace(supabase, data.user);
    } catch {
      const failed = NextResponse.redirect(`${origin}/login?error=workspace_unavailable`);
      response.cookies.getAll().forEach((cookie) => failed.cookies.set(cookie));
      return failed;
    }

    return response;
  } catch {
    return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
  }
}
