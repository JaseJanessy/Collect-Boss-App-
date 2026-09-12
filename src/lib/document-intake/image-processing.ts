import "server-only";

import { createHash } from "node:crypto";
import sharp from "sharp";
import { IMAGE_QUALITY_MESSAGES, type ImageQualityWarning, validateImageDimensions } from "../../../shared/image-intake";
import { DOCUMENT_IMAGE_LIMITS } from "./validation";

function laplacianVariance(pixels: Uint8Array, width: number, height: number) {
  if (width < 3 || height < 3) return 0;
  let count = 0; let sum = 0; let sumSquares = 0;
  for (let y = 1; y < height - 1; y += 1) for (let x = 1; x < width - 1; x += 1) {
    const index = y * width + x;
    const value = (4 * pixels[index]) - pixels[index - 1] - pixels[index + 1] - pixels[index - width] - pixels[index + width];
    count += 1; sum += value; sumSquares += value * value;
  }
  return count ? (sumSquares / count) - ((sum / count) ** 2) : 0;
}

function edgeActivity(pixels: Uint8Array, width: number, height: number, mean: number) {
  const threshold = Math.max(35, mean - 45);
  let active = 0; let sampled = 0;
  const test = (index: number) => { sampled += 1; if (pixels[index] < threshold) active += 1; };
  for (let x = 0; x < width; x += 2) { test(x); test((height - 1) * width + x); }
  for (let y = 0; y < height; y += 2) { test(y * width); test(y * width + width - 1); }
  return sampled ? active / sampled : 0;
}

export async function createSafeImagePreview(bytes: Uint8Array, transform: { rotationDegrees: number; cropInsetPercent: number }) {
  try {
    const source = sharp(bytes, { failOn: "error", limitInputPixels: DOCUMENT_IMAGE_LIMITS.maxWidth * DOCUMENT_IMAGE_LIMITS.maxHeight });
    const metadata = await source.metadata();
    const width = metadata.width ?? 0; const height = metadata.height ?? 0;
    const dimensionError = validateImageDimensions(width, height, DOCUMENT_IMAGE_LIMITS);
    if (dimensionError) return { error: dimensionError.message, code: dimensionError.code } as const;
    if (!(["jpeg", "png", "heif"] as Array<typeof metadata.format>).includes(metadata.format)) {
      return { error: "Only PNG, JPEG, and HEIC images are supported.", code: "IMAGE_TYPE_UNSUPPORTED" } as const;
    }

    const orientedBytes = await sharp(bytes, { failOn: "error" }).rotate().rotate(transform.rotationDegrees).toBuffer();
    const oriented = sharp(orientedBytes, { failOn: "error" });
    const orientedMetadata = await oriented.metadata();
    const insetX = Math.floor((orientedMetadata.width ?? width) * transform.cropInsetPercent / 100);
    const insetY = Math.floor((orientedMetadata.height ?? height) * transform.cropInsetPercent / 100);
    const normalized = transform.cropInsetPercent > 0
      ? oriented.extract({ left: insetX, top: insetY, width: (orientedMetadata.width ?? width) - (2 * insetX), height: (orientedMetadata.height ?? height) - (2 * insetY) })
      : oriented;
    const analysis = await normalized.clone().resize({ width: 320, height: 320, fit: "inside", withoutEnlargement: true }).greyscale().raw().toBuffer({ resolveWithObject: true });
    const pixels = analysis.data; const sampleWidth = analysis.info.width; const sampleHeight = analysis.info.height;
    let sum = 0; let bright = 0;
    for (const value of pixels) { sum += value; if (value >= 248) bright += 1; }
    const mean = pixels.length ? sum / pixels.length : 0;
    const warnings: ImageQualityWarning[] = [];
    if (Math.min(width, height) < Math.min(DOCUMENT_IMAGE_LIMITS.minReadableWidth, DOCUMENT_IMAGE_LIMITS.minReadableHeight)) warnings.push("low_resolution");
    if (laplacianVariance(pixels, sampleWidth, sampleHeight) < 85) warnings.push("blurred");
    if (mean < 55) warnings.push("very_dark");
    if (mean > 235) warnings.push("overexposed");
    if (mean <= 235 && bright / Math.max(pixels.length, 1) > 0.16) warnings.push("possible_glare");
    if (edgeActivity(pixels, sampleWidth, sampleHeight, mean) > 0.24) warnings.push("possibly_cropped");

    const preview = await normalized.clone().resize({ width: 1_600, height: 1_600, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    return {
      previewBytes: new Uint8Array(preview.data), previewWidth: preview.info.width, previewHeight: preview.info.height,
      originalWidth: width, originalHeight: height, orientation: metadata.orientation ?? null,
      previewSha256: createHash("sha256").update(preview.data).digest("hex"),
      warnings, warningMessages: warnings.map((warning) => IMAGE_QUALITY_MESSAGES[warning]),
    } as const;
  } catch {
    return { error: "The selected image could not be read.", code: "IMAGE_UNREADABLE" } as const;
  }
}
