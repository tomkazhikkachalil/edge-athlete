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
// Re-verified 2026-08-27 against the Next 16.3.3 upgrade guide (installed:
// 16.3.1): edge is still unsupported in `proxy` and the guide itself says
// "If you want to continue using the edge runtime, keep using middleware."
// Neither trigger is met; the deprecation warning remains the project's one
// accepted build warning.
//
// Migrating is also three changes, not one: rename the file, rename the export,
// and prune sentry.edge.config.ts plus the NEXT_RUNTIME === 'edge' branch in
// instrumentation.ts, which go dead once middleware runs on Node.
// ─────────────────────────────────────────────────────────────────────────────
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { buildCsp, buildStaticCsp, CSP_REPORT_PATH } from '@/lib/csp'
import { computeSubdomainRedirect } from '@/lib/org-sites/subdomain'
import { RESERVED_ROOT_SLUGS, firstPathSegment } from '@/lib/org-sites/reserved'
import { THEME_COOKIE, THEME_COOKIE_MAX_AGE, encodeThemeCookie } from '@/lib/theme-cookie'
import { sanitizeThemePrefs } from '@/lib/theme-prefs'

// The R3 spike's measured experiment (see the phase-2 plan + DEVLOG):
// with PUBLIC_STANDINGS_CACHE=1, the anonymous public-standings path
// skips this middleware's per-request work ENTIRELY — no auth round
// trip, no per-request nonce — and gets a static CSP (buildStaticCsp:
// a deliberate relaxation on this one read-only path) plus a CDN
// Cache-Control on the DOCUMENT. That is the only way a document can
// ever be a CDN HIT through middleware; the experiment records whether
// x-vercel-cache: HIT is actually reachable. Default OFF = today's
// behavior byte-for-byte. Kill switch: unset the env + redeploy.
// Phase 3 R2: widened to the club twin — /club/[id]/standings is the same
// anonymous viewer-independent page, so it rides the same carve-out.
const STANDINGS_PATH_RE =
  /^\/(league|club)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/standings\/?$/i

// Phase 3: the (public) segment's path family. With PUBLIC_ORG_SITES=1,
// /org/* skips the auth round trip + nonce and gets the static CSP; the
// ISR renderer owns Cache-Control (the spike taught middleware cannot).
const ORG_SITE_PATH_RE = /^\/org\//

// R4: the crawler files. They exist for every visitor and need neither
// auth nor a nonce — without this branch a robots.txt hit would pay the
// full supabase.auth.getUser() round trip (the matcher doesn't exclude
// .txt/.xml, and that regex is too fragile to grow).
const CRAWLER_PATH_RE = /^\/(robots\.txt|sitemap\.xml)$/

export async function middleware(request: NextRequest) {
  // R4, FIRST on purpose (host-based; must precede the path-based /org/
  // branch): {slug}.<appHost> 301s to /org/{slug}. Inert until Tom's
  // wildcard DNS exists; BUILD-INJECTED like its sibling flags — needs a
  // real build, not a redeploy (the thrice-recorded trap). Apex derives
  // from NEXT_PUBLIC_APP_URL: no domain is hardcoded anywhere.
  if (process.env.ORG_SUBDOMAINS === '1') {
    const appHost = new URL(
      process.env.NEXT_PUBLIC_APP_URL || 'https://edge-athlete.vercel.app'
    ).host
    const target = computeSubdomainRedirect(
      request.headers.get('host'),
      appHost,
      request.nextUrl.pathname,
      request.nextUrl.search
    )
    if (target) return NextResponse.redirect(target, 301)
  }
  if (CRAWLER_PATH_RE.test(request.nextUrl.pathname)) {
    const response = NextResponse.next()
    const staticCsp = buildStaticCsp({ dev: process.env.NODE_ENV !== 'production' })
    const enforceStatic =
      process.env.NODE_ENV === 'production' && process.env.CSP_ENFORCE !== '0'
    response.headers.set(
      enforceStatic ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only',
      staticCsp
    )
    response.headers.set('Reporting-Endpoints', `csp="${CSP_REPORT_PATH}"`)
    return response
  }
  if (
    process.env.PUBLIC_ORG_SITES === '1' &&
    ORG_SITE_PATH_RE.test(request.nextUrl.pathname)
  ) {
    const response = NextResponse.next()
    const staticCsp = buildStaticCsp({ dev: process.env.NODE_ENV !== 'production' })
    const enforceStatic =
      process.env.NODE_ENV === 'production' && process.env.CSP_ENFORCE !== '0'
    response.headers.set(
      enforceStatic ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only',
      staticCsp
    )
    response.headers.set('Reporting-Endpoints', `csp="${CSP_REPORT_PATH}"`)
    return response
  }
  // Phase 6 R1: the vanity org tree — /{slug}[/...] where the first
  // segment is DNS-label-shaped and NOT a reserved root slug gets the
  // same static-CSP fast path as /org/*. The FOURTH build-injected flag
  // (real build, not redeploy). Failure asymmetry justifies the shape:
  // a junk path fast-pathed just 404s in the (public) tree, but a real
  // app route wrongly matched here would lose session refresh — which is
  // why RESERVED_ROOT_SLUGS is pinned to the live route tree by
  // reserved.test.ts and this branch checks it FIRST.
  if (process.env.NEXT_PUBLIC_VANITY_ORG_PATHS === '1') {
    const seg = firstPathSegment(request.nextUrl.pathname)
    if (
      seg.length >= 3 &&
      !RESERVED_ROOT_SLUGS.has(seg) &&
      /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(seg)
    ) {
      const response = NextResponse.next()
      const staticCsp = buildStaticCsp({ dev: process.env.NODE_ENV !== 'production' })
      const enforceStatic =
        process.env.NODE_ENV === 'production' && process.env.CSP_ENFORCE !== '0'
      response.headers.set(
        enforceStatic ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only',
        staticCsp
      )
      response.headers.set('Reporting-Endpoints', `csp="${CSP_REPORT_PATH}"`)
      return response
    }
  }
  if (
    process.env.PUBLIC_STANDINGS_CACHE === '1' &&
    STANDINGS_PATH_RE.test(request.nextUrl.pathname)
  ) {
    const response = NextResponse.next()
    const staticCsp = buildStaticCsp({ dev: process.env.NODE_ENV !== 'production' })
    const enforceStatic =
      process.env.NODE_ENV === 'production' && process.env.CSP_ENFORCE !== '0'
    response.headers.set(
      enforceStatic ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only',
      staticCsp
    )
    response.headers.set('Reporting-Endpoints', `csp="${CSP_REPORT_PATH}"`)
    response.headers.set(
      'Cache-Control',
      'public, s-maxage=300, stale-while-revalidate=600'
    )
    return response
  }
  // Per-request CSP nonce (hardening round). It rides a REQUEST header so
  // Next auto-nonces its own inline bootstrap scripts, and x-nonce lets the
  // root layout stamp the theme script. Both response constructions below
  // must carry these request headers or the nonce never reaches the render.
  const nonce = btoa(crypto.randomUUID())
  const csp = buildCsp(nonce, { dev: process.env.NODE_ENV !== 'production' })
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('content-security-policy', csp)

  let response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          response = NextResponse.next({
            request: {
              headers: requestHeaders,
            },
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set({ name, value, ...options })
          )
        },
      },
    }
  )

  // Refresh session if expired - required for SSR
  const { data: { user } } = await supabase.auth.getUser()

  await syncThemeCookie(request, response, supabase, user?.id)

  // ENFORCED in production (owner decision, Aug 2026) with a kill switch:
  // CSP_ENFORCE=0 sends the identical policy Report-Only — rollback is an
  // env flip + redeploy, no code revert. Dev is ALWAYS report-only:
  // Turbopack's HMR/overlay inject un-nonce-able scripts, and fighting them
  // buys nothing. Set on the FINAL response object (setAll may have rebuilt
  // it above).
  const enforce =
    process.env.NODE_ENV === 'production' && process.env.CSP_ENFORCE !== '0'
  response.headers.set(
    enforce ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only',
    csp
  )
  response.headers.set('Reporting-Endpoints', `csp="${CSP_REPORT_PATH}"`)

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
