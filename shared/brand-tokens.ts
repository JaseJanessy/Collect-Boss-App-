import tokens from "./brand-tokens.json" with { type: "json" };

/**
 * Authoritative CollectBoss Main visual tokens.
 *
 * Platform adapters may map these roles to CSS custom properties, React Native
 * styles, PDF RGB values, or manifest fields. They must not redefine values.
 */
export const brandTokens = tokens;

export type BrandTokens = typeof brandTokens;
