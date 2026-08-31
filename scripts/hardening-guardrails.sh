#!/usr/bin/env bash
# Hardening guardrails — cheap, high-signal pattern checks that encode the
# exact regressions the Aug 2026 pre-scale audit fixed, so they cannot
# silently return. Runs in CI on every PR (see .github/workflows/ci.yml) and
# is safe to run locally: `bash scripts/hardening-guardrails.sh`.
#
# HARD failures (exit 1) are exact-match, zero-false-positive regressions.
# ADVISORY notes (printed, never fail) are heuristics worth a human glance.
# Escape hatch: add a `hardening-ok` comment on the offending line to exempt
# a deliberate exception.
set -uo pipefail
cd "$(dirname "$0")/.."

fail=0
note() { printf '  \033[33m⚠\033[0m  %s\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m  %s\n' "$1"; fail=1; }
ok()   { printf '  \033[32m✓\033[0m  %s\n' "$1"; }

# Grep helper: ripgrep if available, else git grep. Excludes this script and
# lines marked hardening-ok.
scan() { # <pattern> <path-glob...>
  local pat="$1"; shift
  git grep -nE "$pat" -- "$@" 2>/dev/null \
    | grep -v 'scripts/hardening-guardrails.sh' \
    | grep -v 'hardening-ok' || true
}

echo "▸ Hardening guardrails"

# 1. The .or()/.ilike() sanitizer must STRIP delimiters, never backslash-escape
#    them (not PostgREST's documented mechanism — injection risk). We removed
#    the backslash form; forbid its return.
hits=$(scan "replace\(/\[\\\\\\\\%_\(\),\.\"'\]/" 'src/**/*.ts')
if [ -n "$hits" ]; then
  bad "backslash-escaping .or() sanitizer is back (use the strip approach, cf. course-catalog likeSafe):"
  echo "$hits" | sed 's/^/      /'
else
  ok "no backslash .or() sanitizer"
fi

# 2. requireAuth throws a Response; a route catch must RETURN it, not throw
#    (a thrown Response becomes a 500 at the handler boundary in this Next).
hits=$(scan "instanceof Response\) throw" 'src/app/api/**/*.ts')
if [ -n "$hits" ]; then
  bad "'instanceof Response) throw' in an API route — must be 'return' (throw → 500):"
  echo "$hits" | sed 's/^/      /'
else
  ok "no thrown-Response handler regressions"
fi

# 3. API routes must not use await cookies() / next/headers (cookie-header auth
#    only) — except the documented session-writing exceptions.
hits=$(scan "await cookies\(\)|from 'next/headers'" 'src/app/api/**/*.ts' \
  | grep -vE 'auth/(activate|username-login|callback)|athlete-claim/')
if [ -n "$hits" ]; then
  bad "await cookies()/next/headers in an API route outside the documented exceptions:"
  echo "$hits" | sed 's/^/      /'
else
  ok "no disallowed cookie APIs in routes"
fi

# 4. Dependency CVEs — fail on high/critical.
echo "▸ npm audit (high+)"
if npm audit --omit=dev --audit-level=high >/tmp/hardening-audit.log 2>&1; then
  ok "no high/critical advisories"
else
  bad "npm audit found high/critical advisories:"
  tail -20 /tmp/hardening-audit.log | sed 's/^/      /'
fi

# ── Advisory (never fails the build) ────────────────────────────────────────
echo "▸ Advisories (review, non-blocking)"

# Count-by-fetching: .select('id'|'*') whose result is measured with .length.
adv=$(scan "\.select\('(id|\*)'\)" 'src/app/api/**/*.ts' | wc -l | tr -d ' ')
[ "$adv" != "0" ] && note "$adv .select('id'|'*') sites — verify none count via .length (use { count:'exact', head:true })"

# .or()/.filter() built with interpolation — must route through a sanitizer.
adv=$(scan "\.(or|filter)\(\`[^)]*\\\$\{" 'src/app/api/**/*.ts' 'src/lib/**/*.ts' | wc -l | tr -d ' ')
[ "$adv" != "0" ] && note "$adv interpolated .or()/.filter() sites — confirm each sanitizes user input"

# Raw DB/JS error internals in a RESPONSE body (Aug 2026 sweep): the client
# gets a friendly string; message/details/hint/code/stack go to console.error
# (Sentry). Heuristic — matches leak-shaped fields inside a json({...}) line.
adv=$(scan "(error|details|hint|stack): *[A-Za-z]+(Error)?\.(message|details|hint|stack|code)" 'src/app/api/**/*.ts' \
  | grep -v 'console\.' | wc -l | tr -d ' ')
[ "$adv" != "0" ] && note "$adv possible raw-error response bodies — each must ship a friendly string (raw belongs in console.error)"

echo
if [ "$fail" -ne 0 ]; then
  echo "✗ hardening guardrails FAILED"
  exit 1
fi
echo "✓ hardening guardrails passed"
