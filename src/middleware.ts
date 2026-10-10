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
import { verifySessionLocally } from '@/lib/auth/edge-session'
import { jwtSecret } from '@/lib/auth/jwt'
import { NextResponse, type NextRequest } from 'next/server'
import { buildCsp, buildStaticCsp, inlineScriptHashSource, CSP_REPORT_PATH } from '@/lib/csp'
import { PUBLIC_THEME_SCRIPT } from '@/lib/theme-script'
import { computeSubdomainRedirect } from '@/lib/org-sites/subdomain'
import {
  bareHost,
  computeApexDomainRedirect,
  computeCustomHostRewrite,
  isAppHost,
  resolveHost,
  resolveSlugDomain,
} from '@/lib/org-sites/domain-cache'
import { RESERVED_ROOT_SLUGS, firstPathSegment } from '@/lib/org-sites/reserved'
import { GATED_ROBOTS, isLaunchGateOn, launchGateRedirect } from '@/lib/launch-gate'

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

// One digest per cold start: the script's text is a build-time constant.
let publicThemeHash: Promise<string> | null = null
function publicThemeScriptHash(): Promise<string> {
  publicThemeHash ??= inlineScriptHashSource(PUBLIC_THEME_SCRIPT)
  return publicThemeHash
}

/** The static-CSP fast path's headers (phase 6b C2 factored the four
 *  copies): no nonce, no auth round trip — the ISR renderer owns caching. */
function withStaticCsp(response: NextResponse): NextResponse {
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

export async function middleware(request: NextRequest) {
  // Phase 6b C2, FIRST of all (host-based): an org's OWN domain. With
  // CUSTOM_DOMAINS=1 (build-injected — a real build, not a redeploy) a
  // request whose Host is not ours is looked up through the anon RPCs
  // (171, THE bounded posture-A exception; domain-cache.ts caches it).
  //   verified host → REWRITE (never redirect) into the vanity tree, so
  //   kmha.ca/teams serves /{slug}/teams while the URL bar keeps kmha.ca;
  //   /.well-known/edge-athlete answers the slug (C1's reachability
  //   proof, the ONLY path that activates a domain); crawler files map to
  //   the per-site routes. Unknown host → fall through → a plain 404.
  // The apex side: /{slug}[/...] and /org/{slug}[/...] of an ACTIVE domain
  // 301 to it single-hop (carve-outs: preview links, card.png, favicon,
  // crawler files). Never 301 to a domain that isn't active — no dead ends.
  const customDomainsOn = process.env.CUSTOM_DOMAINS === '1'
  const apexHost = new URL(
    process.env.NEXT_PUBLIC_APP_URL || 'https://edge-athlete.vercel.app'
  ).host
  if (customDomainsOn) {
    const host = bareHost(request.headers.get('host'))
    if (host && !isAppHost(host, apexHost)) {
      const hit = await resolveHost(host)
      if (hit) {
        const plan = computeCustomHostRewrite(request.nextUrl.pathname, hit.slug)
        if (plan.kind === 'well-known') {
          return new NextResponse(hit.slug, {
            status: 200,
            headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
          })
        }
        const target = new URL(`${plan.target}${request.nextUrl.search}`, request.url)
        return withStaticCsp(NextResponse.rewrite(target))
      }
      // Unknown custom host: let Next answer (the (public) 404 for root
      // labels, the app for anything else) — nothing to serve here.
    } else if (host) {
      // Apex: does this path belong to a site whose domain is ACTIVE?
      const seg0 = firstPathSegment(request.nextUrl.pathname)
      const slug =
        seg0 === 'org' ? firstPathSegment(request.nextUrl.pathname.slice('/org'.length)) : seg0
      if (
        slug.length >= 3 &&
        !RESERVED_ROOT_SLUGS.has(slug) &&
        /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(slug)
      ) {
        const domain = await resolveSlugDomain(slug)
        if (domain) {
          const target = computeApexDomainRedirect(
            request.nextUrl.pathname,
            request.nextUrl.search,
            slug,
            domain
          )
          if (target) return NextResponse.redirect(target, 301)
        }
      }
    }
  }
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
      request.nextUrl.search,
      // R2: canonical-on subdomains land on /{slug} in ONE hop.
      process.env.NEXT_PUBLIC_VANITY_CANONICAL === '1' ? '' : '/org'
    )
    if (target) return NextResponse.redirect(target, 301)
  }
  // The launch gate (Sep 30 2026): while NEXT_PUBLIC_LAUNCH_GATE=1, a signed-OUT
  // visitor goes to the coming-soon page on every path but a few
  // (launch-gate.ts), and the crawler files say "index nothing". This runs
  // BEFORE the anonymous fast paths below (org sites, vanity, standings),
  // which would otherwise serve a stranger a public page. A signed-in
  // account falls through to the app unchanged. The session read costs the
  // round trip the normal path pays anyway; only gated paths pay it here.
  // The gate's session read, kept for the session refresh below (speed
  // round, Oct 2026): a signed-in navigation used to ask Supabase Auth TWICE
  // — here, then again for the refresh. `undefined` = the gate did not read.
  // Speed round 2: the middleware only ever needs WHO — `{ id }` from the
  // locally verified token when SUPABASE_JWT_SECRET is set (no Supabase
  // client, no network), else Supabase Auth's answer (which also refreshes a
  // near-expiry session and rewrites the cookies — the one case the local
  // check hands over on purpose, so refresh frequency is unchanged).
  let gateUser: { id: string } | null | undefined
  const gateCookies: { name: string; value: string; options?: Record<string, unknown> }[] = []
  if (isLaunchGateOn()) {
    if (CRAWLER_PATH_RE.test(request.nextUrl.pathname)) {
      const robots = request.nextUrl.pathname === '/robots.txt'
      return new NextResponse(robots ? GATED_ROBOTS : '', {
        status: robots ? 200 : 404,
        headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
      })
    }
    const target = launchGateRedirect(request.nextUrl.pathname, request.nextUrl.search)
    if (target) {
      // A refreshed session's cookies are KEPT (they reach the request now
      // and the response below) — the same work the refresh client does, so
      // the refresh client need not ask again.
      const gateClient = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          cookies: {
            getAll: () => request.cookies.getAll(),
            setAll: cookiesToSet => {
              cookiesToSet.forEach(({ name, value, options }) => {
                request.cookies.set(name, value)
                gateCookies.push({ name, value, options: options as Record<string, unknown> | undefined })
              })
            },
          },
        }
      )
      const local = await readLocalSession(request)
      if (local) {
        gateUser = local
      } else {
        const { data } = await gateClient.auth.getUser()
        gateUser = data.user
      }
      if (!gateUser) return NextResponse.redirect(new URL(target, request.url), 307)
    }
  }
  if (CRAWLER_PATH_RE.test(request.nextUrl.pathname)) {
    return withStaticCsp(NextResponse.next())
  }
  if (
    process.env.PUBLIC_ORG_SITES === '1' &&
    ORG_SITE_PATH_RE.test(request.nextUrl.pathname)
  ) {
    // Phase 6 R2: with the canonical flipped (BOTH vanity flags on),
    // /org/{slug}/* 301s to /{slug}/* — pure string work, no DB.
    // Carve-outs: preview/[token] (console-only, must never bounce) and
    // card.png (OG scrapers keep a stable direct URL; both routes serve
    // identical bytes and only one is ever advertised).
    if (
      process.env.NEXT_PUBLIC_VANITY_CANONICAL === '1' &&
      process.env.NEXT_PUBLIC_VANITY_ORG_PATHS === '1'
    ) {
      const rest = request.nextUrl.pathname.slice('/org'.length) // "/{slug}..."
      const seg = firstPathSegment(rest)
      if (
        seg.length >= 3 &&
        !RESERVED_ROOT_SLUGS.has(seg) &&
        !rest.includes('/preview/') &&
        !rest.endsWith('/card.png')
      ) {
        return NextResponse.redirect(
          new URL(`${rest}${request.nextUrl.search}`, request.url),
          301
        )
      }
    }
    return withStaticCsp(NextResponse.next())
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
      return withStaticCsp(NextResponse.next())
    }
  }
  if (
    process.env.PUBLIC_STANDINGS_CACHE === '1' &&
    STANDINGS_PATH_RE.test(request.nextUrl.pathname)
  ) {
    const response = withStaticCsp(NextResponse.next())
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
  const csp = buildCsp(nonce, {
    dev: process.env.NODE_ENV !== 'production',
    // The (public) layout's theme script is static (no nonce possible) and
    // some of its pages come through here — /clubs, /leagues, the root 404.
    scriptHashes: [await publicThemeScriptHash()],
  })
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

  // Refresh session if expired - required for SSR. When the launch gate
  // already read (and, if needed, refreshed) this session, its answer and
  // its cookies are used — one Auth round trip per navigation, not two.
  let user: { id: string } | null | undefined = gateUser
  if (user === undefined) {
    user = await readLocalSession(request)
    if (!user) {
      const { data } = await supabase.auth.getUser()
      user = data.user
    }
  } else {
    for (const { name, value, options } of gateCookies) {
      response.cookies.set({ name, value, ...(options ?? {}) })
    }
  }
  void user

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
 * The local session check (speed round 2): the access token in the cookie,
 * verified with the project's JWT secret — microseconds, no Supabase client.
 * Null when the secret is unset, the cookie is absent, the token is invalid
 * or within a minute of expiry: every one of those takes the network path,
 * which is where @supabase/ssr refreshes the session. See src/lib/auth/jwt.ts.
 */
async function readLocalSession(request: NextRequest): Promise<{ id: string } | null> {
  const claims = await verifySessionLocally({
    getCookie: name => request.cookies.get(name)?.value,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    secret: jwtSecret(),
  })
  return claims ? { id: claims.sub } : null
}

// The `ea-theme` cookie used to be re-read from profiles.theme_prefs here on
// every document load — a second sequential query before any HTML (Oct 1
// 2026). Removed (speed round 2): the client writes the cookie on every
// change (theme-cookie.ts writeThemeCookie), adoptServerThemePrefs corrects a
// theme set on ANOTHER device after the profile read, and PATCH
// /api/settings/theme sets the cookie on its own answer. A signed-out device
// keeps its last-known look, as before.

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
     * - offline.html (the service worker's static offline page — precached
     *   at install whatever the session, so neither the launch gate's
     *   redirect nor a per-request CSP nonce may touch it; it holds no data)
     */
    '/((?!api|_next/static|_next/image|favicon.ico|offline\\.html$|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
