import "server-only";

import sharp from "sharp";

const MAX_OCR_IMAGE_EDGE = 2_400;

/** Creates a bounded derived PNG for OCR and never mutates or overwrites the original. */
export async function preprocessImageForOcr(bytes: Uint8Array): Promise<Uint8Array> {
  const output = await sharp(bytes, { failOn: "error" })
    .rotate()
    .resize({ width: MAX_OCR_IMAGE_EDGE, height: MAX_OCR_IMAGE_EDGE, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .greyscale()
    .normalise()
    .png({ compressionLevel: 9 })
    .toBuffer();
  return new Uint8Array(output);
}
