# Phase 1 engineering baseline

**Scope:** verification-only checkpoint after Prompts 1–4. This report records
local evidence; it is not a production-readiness declaration.

## Protected worktree

- Repository: `D:\Web App and phone app\COMPLETED & RUN\Completed Collectboss\collectboss`
- Branch and baseline revision: `main` at `483aa05bc2f0bd2bcf085ea2ead169e49cc70cc2`
- The pre-existing uncommitted worktree was preserved. No reset, restore, clean,
  stash, commit, or branch change was performed for this checkpoint.
- At the start of this verification, Git reported 58 tracked unstaged changes and
  21 untracked paths. This report is an additional untracked documentation file.

## Local toolchain

- Node.js `v24.18.0`; `npm.cmd` `11.16.0`
- Next.js `16.2.7`; ESLint `9.39.4`; TypeScript `5.9.3`
- The repository's `npm.ps1` shim is blocked by the local PowerShell execution
  policy. Use `npm.cmd` from this repository path. The path contains an ampersand,
  so always pass it as one literal PowerShell path argument.

## Repeated baseline suite

Both passes used only non-secret public placeholder values for the production
configuration check. They did not contact Supabase, Stripe, or any remote service.

| Check | Pass 1 | Pass 2 |
| --- | --- | --- |
| `node .\\node_modules\\typescript\\bin\\tsc --noEmit` | exit 0 | exit 0 |
| `npm.cmd run lint` | exit 0; 81 warnings, 0 errors | exit 0; 81 warnings, 0 errors |
| `npm.cmd run build` | exit 0 | exit 0 |

The production build completed its Next.js Turbopack compile, type validation, and
route generation in both passes. This establishes local reproducibility only.

## Lint debt

The 81 warnings are not build blockers but must remain visible:

- 78 `@typescript-eslint/no-unused-vars`
- 2 `jsx-a11y/alt-text`
- 1 `react-hooks/exhaustive-deps`

## Route and configuration probes

Development mode with explicit mock data and no Supabase credentials returned:

- `/` — 200
- `/cases` — 200
- `/login` — 200
- `POST /api/public/acknowledge/baseline-invalid-token` — 404

With `NEXT_PUBLIC_APP_ENV=production`, mock data explicitly enabled, and the
Supabase public configuration absent, `/cases` returned 500. The response was the
expected fail-closed configuration error: mocks are never allowed in staging or
production.

## Commands to repeat

Run from the repository root:

```powershell
node .\node_modules\typescript\bin\tsc --noEmit
npm.cmd run lint
$env:NEXT_PUBLIC_APP_ENV='production'
$env:NEXT_PUBLIC_SUPABASE_URL='https://example.supabase.co'
$env:NEXT_PUBLIC_SUPABASE_ANON_KEY='public-anon-placeholder'
$env:NEXT_PUBLIC_APP_URL='https://app.example.invalid'
npm.cmd run build
```

Remove the temporary process environment variables after the build. Never place
real credentials in command history, source, browser-visible values, or this report.

## Known limits and next gates

- No real staging Supabase, Stripe, storage, RLS, authentication, email, or webhook
  integration was exercised.
- The protected worktree is intentionally not a Git checkpoint; the baseline is an
  evidence record tied to the revision above.
- Dependency audit findings and the lint warnings require later triage. No automatic
  dependency update or formatter was run.
- Generated `.next`, `node_modules`, and `.env*` paths are ignored. They were not
  added to version control.

Prompt 6 may use this checkpoint only after the protected-worktree state and the
remaining risks have been reviewed.
