import { brandTokens } from "./theme.ts";

export type PdfRgb = readonly [number, number, number];

function hexToRgb(hex: string): PdfRgb {
  const value = hex.replace("#", "");
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

/** jsPDF adapter; values remain owned by shared/brand-tokens.json. */
export const brandPdfColors = {
  navy: hexToRgb(brandTokens.brand.navy),
  green: hexToRgb(brandTokens.brand.green),
  surface: hexToRgb(brandTokens.surface.default),
  background: hexToRgb(brandTokens.background),
  text: hexToRgb(brandTokens.text.primary),
  textSecondary: hexToRgb(brandTokens.text.secondary),
  border: hexToRgb(brandTokens.border.default),
  success: hexToRgb(brandTokens.status.success),
  successSurface: hexToRgb(brandTokens.status.successSurface),
  warning: hexToRgb(brandTokens.status.warning),
  warningSurface: hexToRgb(brandTokens.status.warningSurface),
  danger: hexToRgb(brandTokens.status.dangerStrong),
  dangerSurface: hexToRgb(brandTokens.status.dangerSurface),
} as const;
