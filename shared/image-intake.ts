export const IMAGE_INTAKE_DEFAULT_LIMITS = {
  maxBytes: 15 * 1024 * 1024,
  maxWidth: 12_000,
  maxHeight: 12_000,
  minReadableWidth: 800,
  minReadableHeight: 600,
} as const;

export type SupportedImageMime = "image/jpeg" | "image/png" | "image/heic";
export type ImageEvidenceSource = "screenshot" | "bank_in_receipt" | "other_image";
export type ImageQualityWarning =
  | "low_resolution"
  | "blurred"
  | "very_dark"
  | "overexposed"
  | "possible_glare"
  | "possibly_cropped";

export const IMAGE_QUALITY_MESSAGES: Record<ImageQualityWarning, string> = {
  low_resolution: "The image resolution is low and small text may be hard to read.",
  blurred: "The image may be blurred. Review it and retake if the text is unclear.",
  very_dark: "The image may be too dark to read clearly.",
  overexposed: "The image may be overexposed and washed out.",
  possible_glare: "Bright areas may be glare. Check that the amount, date, and reference remain visible.",
  possibly_cropped: "Content reaches the image edge. Check that the full receipt is inside the frame.",
};

export type ImageIntakeLimits = {
  maxBytes: number;
  maxWidth: number;
  maxHeight: number;
  minReadableWidth: number;
  minReadableHeight: number;
};
export type ImageInspection = {
  extension: "jpg" | "png" | "heic";
  mimeType: SupportedImageMime;
  width: number | null;
  height: number | null;
};

function u32(bytes: Uint8Array, offset: number) {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function jpegDimensions(bytes: Uint8Array) {
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2 || offset + length + 2 > bytes.length) break;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { height: (bytes[offset + 5] << 8) | bytes[offset + 6], width: (bytes[offset + 7] << 8) | bytes[offset + 8] };
    }
    offset += length + 2;
  }
  return null;
}

export function inspectImageBytes(bytes: Uint8Array): ImageInspection | null {
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[12] === 0x49 && bytes[13] === 0x48 && bytes[14] === 0x44 && bytes[15] === 0x52) {
    return { extension: "png", mimeType: "image/png", width: u32(bytes, 16), height: u32(bytes, 20) };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9) {
    const dimensions = jpegDimensions(bytes);
    return { extension: "jpg", mimeType: "image/jpeg", width: dimensions?.width ?? null, height: dimensions?.height ?? null };
  }
  if (bytes.length >= 16 && String.fromCharCode(...bytes.subarray(4, 8)) === "ftyp") {
    const brand = String.fromCharCode(...bytes.subarray(8, Math.min(bytes.length, 32)));
    if (/(?:heic|heix|hevc|hevx|mif1|msf1)/u.test(brand)) {
      return { extension: "heic", mimeType: "image/heic", width: null, height: null };
    }
  }
  return null;
}

export function configuredImageIntakeLimits(input: Partial<Record<keyof ImageIntakeLimits, string | number | null>> = {}): ImageIntakeLimits {
  const value = <K extends keyof ImageIntakeLimits>(key: K) => {
    const parsed = Number(input[key]);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : IMAGE_INTAKE_DEFAULT_LIMITS[key];
  };
  return {
    maxBytes: value("maxBytes"), maxWidth: value("maxWidth"), maxHeight: value("maxHeight"),
    minReadableWidth: value("minReadableWidth"), minReadableHeight: value("minReadableHeight"),
  };
}

export function validateImageDimensions(width: number, height: number, limits: ImageIntakeLimits = IMAGE_INTAKE_DEFAULT_LIMITS) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    return { code: "IMAGE_UNREADABLE", message: "The selected image could not be read." };
  }
  if (width > limits.maxWidth || height > limits.maxHeight) {
    return { code: "IMAGE_DIMENSIONS_TOO_LARGE", message: "The selected image dimensions are too large." };
  }
  return null;
}
