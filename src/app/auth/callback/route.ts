import { type NextRequest, NextResponse } from "next/server";
import { isSupabaseConfigured, SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/supabase/client";

/**
 * Supabase Auth callback handler.
 * Called after email confirmation, password reset, and magic link clicks.
 * Exchanges the `code` in the URL for a session.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code  = searchParams.get("code");
  const next  = searchParams.get("next") ?? "/";

  if (!isSupabaseConfigured || !code) {
    return NextResponse.redirect(`${origin}${next}`);
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

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
    }

    return response;
  } catch {
    return NextResponse.redirect(`${origin}/login`);
  }
}
