import "server-only";

import { APP_URL, isDeploymentEnvironment } from "@/lib/supabase/client";

const LOCALHOST_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

const configurationError =
  "[CollectBoss] Blocking configuration error: set NEXT_PUBLIC_APP_URL to the canonical HTTPS application URL in staging or production.";

/**
 * Returns the canonical application URL used in server-generated public links
 * and third-party redirects. Deployment environments are deliberately fail-closed: a missing,
 * non-HTTPS, or localhost URL must never result in a localhost redirect.
 */
export function getAppUrl(): string {
  const configured = APP_URL;
  if (!configured) {
    if (isDeploymentEnvironment) throw new Error(configurationError);
    return "http://localhost:3000";
  }

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error(configurationError);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(configurationError);
  }

  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(configurationError);
  }

  if (
    isDeploymentEnvironment &&
    (url.protocol !== "https:" || LOCALHOST_HOSTS.has(url.hostname))
  ) {
    throw new Error(configurationError);
  }

  return url.toString().replace(/\/$/, "");
}
