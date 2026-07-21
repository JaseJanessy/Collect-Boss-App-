<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Codex Production Fix Rules

1. Do not refactor unrelated files.
2. Do not redesign UI unless the task explicitly asks for layout fixes.
3. Do not make broad changes across the app in one pass.
4. Always fix one category of issue at a time.
5. Never hardcode API keys, Supabase keys, Stripe keys, or secrets.
6. Never expose service_role keys in frontend/client code.
7. Do not allow production to fall back to mock data.
8. If environment variables are missing in production, fail loudly with a clear error.
9. If database schema or RLS changes are needed, propose the SQL first before applying.
10. Keep `supabase/schema.sql` and `src/lib/supabase/rls.sql` consistent.
11. After every code change, run:
    - `npm run typecheck` if available
    - `npm run lint` if available
    - `npm run build` if available
    - otherwise run `npx tsc --noEmit`
12. After every task, report:
    - files changed
    - why each change was made
    - commands run
    - test result
    - remaining risks
13. Do not mark the app production-ready until:
    - TypeScript passes
    - no production mock fallback remains
    - Supabase environment validation is strict
    - RLS policies are consistent
    - public payment/acknowledgement routes are tokenized or safely disabled
    - staff/admin role model is either implemented or removed from launch scope
    - QR/payment fallback route is verified or disabled
