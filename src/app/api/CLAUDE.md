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
your handler DOES wrap work in try/catch, the catch block **MUST re-throw
`instanceof Response`** — otherwise the thrown 401 gets swallowed into a 500
(this exact bug shipped once; see DEVLOG):

```typescript
try {
  const user = await requireAuth(request);
  // ...
} catch (err) {
  if (err instanceof Response) throw err;   // REQUIRED
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}
```

`requireProfileRole(request, profileId, action)` is the guardian-profiles
authorization gate (feature-flagged; see `src/lib/profile-roles.ts`).

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

- **`auth/activate` and `auth/username-login`** use inline `createServerClient`
  with `await cookies()` because they must **set** session cookies — something
  the shared helper structurally can't do (its `set`/`remove` are no-ops).
  Same story for `src/app/auth/callback/route.ts` and `src/middleware.ts`.
- **`account/delete` and `auth/reauthenticate`** keep their own gate + password
  re-verification (`'Unauthorized'` / `'Invalid password'` bodies): destructive
  flows, deliberately not folded into the standard pattern.
- **Cron routes** authenticate with `CRON_SECRET`, not cookies.
