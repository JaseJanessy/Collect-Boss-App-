/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';
import brandTokens from '../../../shared/brand-tokens.json';

export const Colors = {
  light: {
    text: brandTokens.text.primary,
    background: brandTokens.background,
    backgroundElement: brandTokens.surface.default,
    backgroundSelected: brandTokens.interaction.primarySelectedSurface,
    textSecondary: brandTokens.text.secondary,
  },
  dark: {
    text: brandTokens.text.inverse,
    background: brandTokens.surface.inverse,
    backgroundElement: brandTokens.surface.inverseRaised,
    backgroundSelected: brandTokens.interaction.primary,
    textSecondary: brandTokens.text.inverseMuted,
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'sans-serif',
    serif: 'serif',
    rounded: 'sans-serif',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

/** React Native adapter for the authoritative shared Main theme. */
export const CollectBossTokens = {
  color: {
    navy: brandTokens.brand.navy,
    brandGreen: brandTokens.brand.green,
    primary: brandTokens.interaction.primary,
    primaryStrong: brandTokens.interaction.primary,
    primaryHover: brandTokens.interaction.primaryHover,
    primaryPressed: brandTokens.interaction.primaryPressed,
    canvas: brandTokens.background,
    surface: brandTokens.surface.default,
    surfaceRaised: brandTokens.surface.raised,
    surfaceMuted: brandTokens.surface.muted,
    surfaceInverse: brandTokens.surface.inverse,
    surfaceInverseRaised: brandTokens.surface.inverseRaised,
    surfaceOverlay: brandTokens.surface.overlay,
    foreground: brandTokens.text.primary,
    mutedForeground: brandTokens.text.secondary,
    inverseForeground: brandTokens.text.inverse,
    inverseMutedForeground: brandTokens.text.inverseMuted,
    border: brandTokens.border.default,
    borderStrong: brandTokens.border.strong,
    borderInverse: brandTokens.border.inverse,
    focus: brandTokens.border.focus,
    selectedSurface: brandTokens.interaction.primarySelectedSurface,
    selectedText: brandTokens.interaction.primarySelectedText,
    verified: brandTokens.status.success,
    successSurface: brandTokens.status.successSurface,
    successBorder: brandTokens.status.successBorder,
    pending: brandTokens.status.warning,
    warningSurface: brandTokens.status.warningSurface,
    warningBorder: brandTokens.status.warningBorder,
    disputed: brandTokens.status.information,
    informationSurface: brandTokens.status.informationSurface,
    informationBorder: brandTokens.status.informationBorder,
    overdue: brandTokens.status.dangerStrong,
    failed: brandTokens.status.dangerStrong,
    dangerSurface: brandTokens.status.dangerSurface,
    dangerBorder: brandTokens.status.dangerBorder,
    closed: brandTokens.status.neutral,
    neutralSurface: brandTokens.status.neutralSurface,
    neutralBorder: brandTokens.status.neutralBorder,
    warning: brandTokens.status.warning,
    highRisk: brandTokens.status.highRisk,
    disabledSurface: brandTokens.disabled.surface,
    disabledBorder: brandTokens.disabled.border,
    disabledText: brandTokens.disabled.text,
  },
  type: { display: 32, title: 24, heading: 18, body: 14, caption: 12 },
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
  radius: { control: 12, surface: 16, pill: 999 },
  targetSize: 44,
} as const;

/** Pocket aliases stay subordinate to the shared CollectBoss identity. */
export const PocketTokens = {
  color: {
    brandNavy: brandTokens.brand.navy,
    brandGreen: brandTokens.brand.green,
    canvas: brandTokens.pocket.canvas,
    surface: brandTokens.pocket.surface,
    surfaceMuted: brandTokens.pocket.surfaceMuted,
    ink: brandTokens.pocket.ink,
    muted: brandTokens.pocket.muted,
    line: brandTokens.pocket.line,
    navyRaised: brandTokens.pocket.navyRaised,
    selectedSurface: brandTokens.pocket.selectedSurface,
    focus: brandTokens.pocket.focus,
    primary: brandTokens.pocket.action.primary,
    primaryHover: brandTokens.pocket.action.primaryHover,
    primaryPressed: brandTokens.pocket.action.primaryPressed,
    addDebt: brandTokens.pocket.action.addDebt,
    addDebtSurface: brandTokens.pocket.action.addDebtSurface,
    recordPayment: brandTokens.pocket.action.recordPayment,
    recordPaymentSurface: brandTokens.pocket.action.recordPaymentSurface,
    scanReceipt: brandTokens.pocket.action.scanReceipt,
    scanReceiptSurface: brandTokens.pocket.action.scanReceiptSurface,
    whoOwesMe: brandTokens.pocket.action.whoOwesMe,
    whoOwesMeSurface: brandTokens.pocket.action.whoOwesMeSurface,
    overdue: brandTokens.pocket.action.overdue,
    overdueSurface: brandTokens.pocket.action.overdueSurface,
  },
  targetSize: 48,
  radius: { control: 16, surface: 24, pill: 999 },
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
