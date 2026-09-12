# Data access boundaries

Use this dependency direction for application data:

```text
UI -> client service -> API route -> server service -> repository -> database provider
```

- **UI** renders state and invokes a client service. It must not call `fetch` or Supabase directly.
- **Client service** owns HTTP transport, response contracts, and transport errors.
- **API route** authenticates the request, validates input, calls a server service, and maps known errors to HTTP responses.
- **Server service** coordinates business operations without importing UI or HTTP concerns.
- **Repository** owns database queries and tenant-scoped persistence operations.
- **Database provider** supplies the authenticated database client and required tenant context.

Shared transport belongs in `src/lib/data/http-service.ts`. Domain-specific contracts, client services, server services, and repositories belong in a domain folder such as `src/lib/customers/`.

Mock data must be selected explicitly at a provider or repository boundary, must never be a production fallback, and must fail closed when required production configuration is absent. UI components and services must not contain mock records. Secrets and provider credentials must only come from validated server-side environment configuration.

The customer/debtor flow is the first migrated vertical slice. Pocket screens share the canonical HTTP transport while their existing API contracts and business behavior remain unchanged. Other domains should move one vertical slice at a time so their existing behavior can be verified independently.
