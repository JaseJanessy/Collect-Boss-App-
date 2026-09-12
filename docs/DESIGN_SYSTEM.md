# CollectBoss design system

This system extends the existing Tailwind v4, Base UI, and shadcn stack. Do not add a second component library. New product UI should use the components in `src/components/ui` and the semantic tokens in `src/app/globals.css`.

React Native uses the matching `CollectBossTokens` export in `mobile/src/constants/theme.ts`. Mobile controls keep native interaction behavior while sharing the same brand, surface, status, spacing, radius, type, and 44px target roles.

## Foundations

- Typography: Geist Sans is the interface and heading family; Geist Mono is reserved for identifiers and machine-readable values. Use display (32px), title (24px), heading (18px), body (14px), and caption (12px) roles.
- Spacing: use Tailwind's 4px base scale. Prefer 8px within compact controls, 12-16px within component groups, 20-24px within surfaces, and 32-40px between major sections.
- Radii: controls use 12px; surfaces and overlays use 16px; status badges use a full pill.
- Borders and shadows: use semantic `border`, `ring`, `cb-surface`, and the surface/overlay shadows. A shadow must not be the only surface boundary.
- Breakpoints: compact is below 640px, tablet is 640-1023px, and desktop is 1024px or wider. Phone landscape shell behavior remains separately defined by viewport height.
- Focus: every interactive element uses the mint, 3px `:focus-visible` ring. Never suppress focus without an equivalent replacement.
- Motion: transitions communicate state only. The global reduced-motion rule removes nonessential animation when the user requests it.

## Colour roles

Brand navy, mint, surface, foreground, muted, border, input, ring, destructive, and chart roles are CSS variables. Use role names rather than raw colours in new components.

Statuses always combine a written label with an icon; colour is supplementary:

| Meaning | Use |
| --- | --- |
| Verified | Identity/business checks, approved or confirmed money |
| Pending | Queued, submitted, promised, or under review |
| Disputed | An open disagreement requiring review |
| Overdue | A due date has passed with a balance remaining |
| Failed | Rejected, failed, or terminally unsuccessful |
| Closed | Completed/inactive records without a positive verification meaning |
| Warning | Recoverable caution requiring attention |
| High risk | Critical or elevated-risk conditions |

Use `StatusBadge` for all of these meanings. Do not substitute a coloured dot without text.

## Components and allowed use

- `Button` is the standard action control. Default is the primary page action; outline is a secondary action; ghost is low emphasis; destructive is for irreversible or materially harmful actions. `PrimaryButton` is a compatibility wrapper and maps to the same variants.
- `InputField`, `SelectField`, and `TextareaField` own label, hint, error, `aria-invalid`, and description wiring. Use `.cb-field` only where a composed field wrapper cannot fit existing markup.
- Native date inputs use `.cb-field`; do not replace the browser date control without a tested keyboard-accessible need.
- `Card`/`.cb-surface` group one concept. Do not nest cards solely to create spacing.
- `DataTableContainer` + `DataTable` provide the approved responsive behavior: horizontal scrolling in a named, keyboard-focusable region. Preserve row headers and never clip columns.
- `StatusBadge` communicates state. `Badge` is only for neutral metadata or taxonomy.
- `Alert` is inline feedback: info, success, warning, or error. Error alerts use an assertive role; other alerts are polite.
- `Tabs` switches views in place. It must receive a concise accessible label and must not be used as page navigation.
- `Dialog` is a blocking decision or short task. `Drawer` is supplemental work that benefits from retaining page context. Both use the native modal dialog focus and Escape behavior; avoid stacking either.
- `Pagination` is for stable page boundaries. Use “load more” only for feeds or server cursors where a page count is unavailable.
- `LoadingState`/`Skeleton` represent content shape. `LoadingSpinner` is for compact or indeterminate waits. Do not show both for the same request.
- `EmptyState`, `PermissionDeniedState`, `OfflineState`, and `ErrorState` are reusable full-region states. State copy must say what happened and, when possible, what the user can do next.
- `ToastRegion` + `Toast` are for transient confirmation that does not require a decision. Validation, security, and payment errors remain inline and persistent.

## Accessibility and content rules

- Pages need one descriptive `h1`; sections use ordered headings.
- Every form control needs a programmatic label. Placeholder text is never a label.
- Icon-only controls need an `aria-label`; decorative icons use `aria-hidden`.
- Use native buttons and links for activation. All targets are at least 44px unless part of a compact composite with an equivalent target.
- Announce asynchronous errors and newly loaded empty states. Avoid duplicate live regions.
- Tables must use header cells and the responsive container. Numeric columns align right when that improves scanning.
- Preserve zoom, text wrapping, safe-area insets, and 16px mobile form text.

## Migration guidance

Apply the system one screen at a time. Replace one-off controls with shared primitives, then verify keyboard order, narrow-width behavior, loading/error/empty states, and the existing workflow before moving to another screen. Compatibility classes (`cb-analytics-light`, `cb-light-surface`) exist for legacy screens while raw colour utilities are removed incrementally.
