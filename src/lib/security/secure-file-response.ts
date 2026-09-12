import "server-only";

const safeInlineTypes = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);

function safeFilename(value: string): string {
  const leaf = value.split(/[\\/]/).at(-1) ?? "download";
  const cleaned = leaf.replace(/[\u0000-\u001f\u007f";]/g, "_").trim();
  return cleaned.slice(0, 180) || "download";
}

export function secureStoredFileResponse(input: {
  blob: Blob;
  filename: string;
  download: boolean;
  contentType?: string | null;
}): Response {
  const requestedType = (input.contentType || input.blob.type || "application/octet-stream").toLowerCase();
  const contentType = safeInlineTypes.has(requestedType) ? requestedType : "application/octet-stream";
  const filename = safeFilename(input.filename);
  const disposition = input.download || contentType === "application/octet-stream" ? "attachment" : "inline";
  return new Response(input.blob, {
    status: 200,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Disposition": `${disposition}; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Content-Length": String(input.blob.size),
      "Content-Type": contentType,
      "Cross-Origin-Resource-Policy": "same-origin",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function inspectQrImage(bytes: Uint8Array, declaredType: string):
  | { contentType: "image/png" | "image/jpeg" | "image/webp"; extension: "png" | "jpg" | "webp" }
  | null {
  const png = bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const webp = bytes.length >= 12
    && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF"
    && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
  if (png && declaredType === "image/png") return { contentType: "image/png", extension: "png" };
  if (jpeg && declaredType === "image/jpeg") return { contentType: "image/jpeg", extension: "jpg" };
  if (webp && declaredType === "image/webp") return { contentType: "image/webp", extension: "webp" };
  return null;
}
