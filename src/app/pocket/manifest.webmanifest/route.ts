import pocketManifest from "../manifest";

export const dynamic = "force-static";

export function GET(): Response {
  return new Response(JSON.stringify(pocketManifest()), {
    headers: {
      "Cache-Control": "public, max-age=0, must-revalidate",
      "Content-Type": "application/manifest+json",
    },
  });
}
