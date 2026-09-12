import { requestJson } from "@/lib/data/http-service";

export interface JsonServiceOptions {
  fallbackMessage: string;
  cache?: RequestCache;
}

/** Creates a domain client while keeping request/error behavior consistent. */
export function createJsonService(options: JsonServiceOptions) {
  return function jsonService<T>(
    url: string,
    init: RequestInit = {},
    fallbackMessage = options.fallbackMessage,
  ) {
    return requestJson<T>(
      url,
      { ...(options.cache ? { cache: options.cache } : {}), ...init },
      fallbackMessage,
    );
  };
}
