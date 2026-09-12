# CollectBoss Main brand theme

`shared/brand-tokens.json` is the only authoritative source of Main brand and semantic colour values.

- Web: `src/lib/brand/theme.ts` maps the shared roles to `--cb-*` CSS custom properties in `src/app/layout.tsx`. `src/app/globals.css` and components consume those properties.
- Expo: `mobile/src/constants/theme.ts` maps the same shared roles to React Native values. `mobile/app.config.js` consumes the JSON source for native icon and splash configuration.
- Static assets: `scripts/brand/generate-brand-assets.mjs` consumes the JSON source and creates approved CB lettermark assets. Legacy assets remain in place for rollback.
- Pocket: `shared/brand-tokens.json` also owns a `pocket` alias group. `src/lib/brand/pocket-theme.ts` maps those roles into `.pocket-root`, and `PocketTokens` maps them to React Native. Pocket aliases never change Main component defaults.

## CollectBoss Pocket

- Primary wordmark: `Collect` uses `#0D1B3D`; `Boss Pocket` uses `#009966`.
- Compact square assets use the approved `CBP` lettermark. They do not replace the primary wordmark in product chrome.
- Large action recognition is limited to Add Debt (green), Record Payment (blue), Scan Receipt (violet), Who Owes Me (orange), and Overdue (danger red).
- Action accents are scoped through `data-pocket-action` and `data-pocket-theme`; they do not enter Main navigation or status semantics.
- Pocket uses solid light surfaces, 48px-or-larger controls, restrained single-step depth, clear focus treatment, and no decorative background gradients.
- Generated Pocket assets are additive: `public/brand/pocket-*` and `mobile/assets/brand/pocket-*`.
- Expo defaults to the Main app identity. A separately branded Pocket binary must explicitly set `EXPO_PUBLIC_PRODUCT_BRAND=pocket`; that switch selects the CBP icon and Pocket splash without changing product routing or shared services.

Release note: aligned CollectBoss Pocket with the approved cross-product identity, added an exact split-colour Pocket wordmark and CBP system assets, introduced accessible action accents, and retained the existing shared services and route boundaries.

The brand green is reserved for the wordmark and deliberate emphasis. Interactive controls use the darker accessible green role. Status components use explicit success, warning, danger, information, neutral and high-risk roles; they also include text and/or icons.

Rollback is additive: revert the Pocket theme files and restore the previous `.pocket-root` rules. Main manifest/app configuration references were not changed for Pocket, and no legacy image asset needs to be recovered because this implementation does not delete or overwrite them.
