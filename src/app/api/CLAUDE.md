# API Route Patterns

**Scope:** These conventions apply to all routes under `src/app/api/`.

## Next.js 15 Cookie Authentication Pattern

**CRITICAL:** All API routes must use cookie header reading (NOT `await cookies()`):

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

// Helper function for cookie authentication
function createSupabaseClient(request: NextRequest) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          const cookieHeader = request.headers.get('cookie');
          if (!cookieHeader) return undefined;
          const cookies = Object.fromEntries(
            cookieHeader.split('; ').map(cookie => {
              const [key, value] = cookie.split('=');
              return [key, decodeURIComponent(value)];
            })
          );
          return cookies[name];
        },
      },
    }
  );
}

export async function GET(request: NextRequest) {
  const supabase = createSupabaseClient(request);

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // RLS automatically enforces access control
  // ...
}
```

## When to Use Admin Client

For operations that bypass RLS (e.g., viewing follow request sender profiles):

```typescript
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

// Use sparingly - bypasses ALL RLS policies
const { data } = await supabaseAdmin.from('profiles').select('*');
```
