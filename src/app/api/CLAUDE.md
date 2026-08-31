# API Route Patterns

**Scope:** These conventions apply to all routes under `src/app/api/`.

## Auth goes through `@/lib/auth-server` — never hand-roll it

All cookie parsing and Supabase client construction for API routes lives in
`src/lib/auth-server.ts` (cookie parsing itself in `src/lib/cookies.ts`, pure
and unit-tested). Do **not** create per-route `createServerClient` helpers or
split cookie headers by hand — that pattern was deleted in July 2026 (~19
copies, one of which shipped a `split('=')` bug that truncated base64 cookie
values app-wide) and must not come back.

Routes must read auth from the `cookie` **header** via these helpers (NOT
`await cookies()` — API routes receive the header, they never write cookies).

### The standard gate: `getServerAuth`

Non-throwing; returns the user (nullable) plus the cookie-scoped RLS client
for your queries. The 401 body is standardized on `'Authentication required'`.

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth } from '@/lib/auth-server';

export async function POST(request: NextRequest) {
  try {
    const { supabase, user, error: authError } = await getServerAuth(request);
    if (authError || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    // Queries through `supabase` run under the user's RLS policies
    // ...
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

If the handler never queries as the user (auth check only), destructure just
`{ user, error }` — an unused `supabase` binding is a lint warning.

### Optional auth (public surfaces)

Anonymous viewers are a supported state on public endpoints (`privacy/check`,
profile media). Same helper, no 401:

```typescript
const { user } = await getServerAuth(request);
const viewerId = user?.id ?? null;   // null = anonymous, and that's fine
```

### The throwing variants: `requireAuth` / `requireAdmin` / `requireProfileRole`

These **throw a `Response`** (401/403) instead of returning. Most routes using
them have no surrounding try/catch and let the thrown Response propagate. If
your handler DOES wrap work in try/catch, the catch block **MUST `return` the
`Response`** — otherwise the thrown 401 gets swallowed into a 500 (this exact
bug shipped once; see DEVLOG):

```typescript
try {
  const user = await requireAuth(request);
  // ...
} catch (err) {
  if (err instanceof Response) return err;   // REQUIRED
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}
```

> **`return`, not `throw`** (corrected Aug 2026). Under Next 16.3.1 a `Response`
> thrown out of a route handler is treated as an unhandled error → **500**, not
> returned as that response. Verified live (`tags` GET: `throw` → 500, `return`
> → 401); 93 routes already use the `return` form. The hardening guardrail
> (`scripts/hardening-guardrails.sh`) fails the build on `instanceof Response) throw`
> in a route.

`requireProfileRole(request, profileId, action)` is the guardian-profiles
authorization gate (see `src/lib/profile-roles.ts`). NOT feature-flagged —
role resolution runs unconditionally since the Wave 1 flag-off inversion
(the flag only hides guardian surfaces, never safety behavior).

## When to Use the Admin Client

For operations that must bypass RLS. Always the lazy factory, always **inside**
the handler — a module-scope `createClient(...)` breaks the build when env vars
are absent during static analysis:

```typescript
import { getSupabaseAdmin } from '@/lib/auth-server';

export async function POST(request: NextRequest) {
  const { user, error } = await getServerAuth(request);
  if (error || !user) { /* 401 */ }

  const admin = getSupabaseAdmin();
  // Use sparingly — bypasses ALL RLS policies. Anything read/written here
  // must be authorized in app code first (most routes here bypass RLS, which
  // is why guardian enforcement is app-layer).
  const { data } = await admin.from('profiles').select('*');
}
```

## Exceptions (deliberate, do not "fix")

- **`auth/activate`, `auth/username-login`, and `athlete-claim/[token]`
  (the accountless self-claim)** use inline `createServerClient` with
  `await cookies()` because they must **set** session cookies — something
  the shared helper structurally can't do (its `setAll` is a no-op).
  Same story for `src/app/auth/callback/route.ts` and `src/middleware.ts`.
- **`account/delete` and `auth/reauthenticate`** keep their own gate + password
  re-verification (`'Unauthorized'` / `'Invalid password'` bodies): destructive
  flows, deliberately not folded into the standard pattern.
- **Cron routes** authenticate with `CRON_SECRET`, not cookies.
