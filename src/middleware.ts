// ─────────────────────────────────────────────────────────────────────────────
// DECISION (2026-07-31, Next 16.2.12): we deliberately stay on the `middleware`
// file convention and accept its build-time deprecation warning. This is the
// project's one known, justified build warning.
//
// Next 16 renames this to `proxy`, and `proxy` is FORCED to the Node.js runtime
// — "it cannot be configured" (Next's words), with edge support explicitly
// deferred to a future minor. Today this file runs as Edge Middleware: a V8
// isolate at the PoP nearest the user. Under `proxy` it becomes a Node function
// bound to us-east-1, because vercel.json pins regions: ["iad1"].
//
// That matters here specifically because this middleware makes a NETWORK CALL
// (supabase.auth.getUser) on every non-API request. A user in Sydney would pay
// Sydney -> Virginia -> Supabase -> back BEFORE routing even begins, plus Node
// cold starts on 100% of navigations. Note the matcher comment below: the `api`
// exclusion exists precisely because getUser() was costing 100-300ms per call.
// Migrating re-introduces that same class of latency on a larger surface, and
// this time the matcher cannot exclude it.
//
// REVISIT WHEN either is true:
//   1. Next ships edge-runtime support for `proxy`, or
//   2. this middleware no longer needs a per-request network call.
//
// Migrating is also three changes, not one: rename the file, rename the export,
// and prune sentry.edge.config.ts plus the NEXT_RUNTIME === 'edge' branch in
// instrumentation.ts, which go dead once middleware runs on Node.
// ─────────────────────────────────────────────────────────────────────────────
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { THEME_COOKIE, THEME_COOKIE_MAX_AGE, encodeThemeCookie } from '@/lib/theme-cookie'
import { sanitizeThemePrefs } from '@/lib/theme-prefs'

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({
            name,
            value,
            ...options,
          })
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          })
          response.cookies.set({
            name,
            value,
            ...options,
          })
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({
            name,
            value: '',
            ...options,
          })
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          })
          response.cookies.set({
            name,
            value: '',
            ...options,
          })
        },
      },
    }
  )

  // Refresh session if expired - required for SSR
  const { data: { user } } = await supabase.auth.getUser()

  await syncThemeCookie(request, response, supabase, user?.id)

  return response
}

/**
 * Keep the `ea-theme` cookie holding the ACCOUNT's theme, so the inline head
 * script paints from server truth instead of this device's possibly-stale
 * memory. Without this the device only learned about a theme set elsewhere
 * from the client-side profile fetch — i.e. a visible swap a few hundred ms
 * after first paint.
 *
 * Scoped to DOCUMENT navigations (`sec-fetch-dest: document`), which is the
 * only time the head script runs — RSC prefetches and client-side navigations
 * skip it. That keeps the extra query off the vast majority of requests
 * through here, which matters because this middleware is already one network
 * round trip per request (see the decision note at the top of this file).
 *
 * Never fatal: any failure leaves whatever cookie is already there, and the
 * localStorage mirror is still behind that.
 */
async function syncThemeCookie(
  request: NextRequest,
  response: NextResponse,
  supabase: ReturnType<typeof createServerClient>,
  userId: string | undefined
) {
  const existing = request.cookies.get(THEME_COOKIE)?.value

  if (!userId) {
    // Signed out: drop the server's copy. The device keeps its own look via
    // the localStorage mirror rather than snapping back to light.
    if (existing) response.cookies.delete(THEME_COOKIE)
    return
  }

  const dest = request.headers.get('sec-fetch-dest')
  const isDocumentLoad = dest === 'document' || dest === null
  if (!isDocumentLoad) return

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('theme_prefs')
      .eq('id', userId)
      .single()

    // On error the value is unknown, NOT empty — writing {} here would paint
    // light for a dark-themed account on the next load.
    if (error) return

    const encoded = encodeThemeCookie(sanitizeThemePrefs(data?.theme_prefs))
    if (encoded === existing) return

    response.cookies.set({
      name: THEME_COOKIE,
      value: encoded,
      path: '/',
      maxAge: THEME_COOKIE_MAX_AGE,
      sameSite: 'lax',
      // Read by the inline head script — a display preference, not a secret.
      httpOnly: false,
      secure: request.nextUrl.protocol === 'https:',
    })
  } catch {
    // network/RLS hiccup — leave the existing cookie alone
  }
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - api (API routes self-authenticate from the raw cookie header —
     *   requireAuth / the cookie-reading pattern — so the middleware's
     *   supabase.auth.getUser() network round trip added ~100-300ms to
     *   EVERY API call for no security benefit. Trade-off: a tab resumed
     *   after its access token expired may 401 on its first API call
     *   where middleware used to refresh inline; the browser client
     *   refreshes within moments and page navigations still pass
     *   through here, keeping SSR sessions fresh.)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (public folder)
     */
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
