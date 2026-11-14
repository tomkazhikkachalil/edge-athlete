#!/usr/bin/env bash
# automerge-pr.sh — ask GitHub to merge ONE pull request by itself once the
# required checks on main (verify, smoke, guardrails) are green.
#
#   bash scripts/automerge-pr.sh <PR number> [--dry-run]
#
# It does not merge anything itself: it turns on GitHub's auto-merge for the
# PR (a merge commit, the house style). GitHub then waits for the branch
# protection on main and merges; a push that lands meanwhile restarts the wait.
#
# Refuses (exit 1, nothing changed) unless ALL of these hold:
#   • the PR is open, not a draft, belongs to this repo and targets main;
#   • it touches NO file under database/migrations/ — a migration runs on
#     production FIRST (Tom, in the SQL editor), then the PR is merged by
#     hand with merge-pr.sh;
#   • main actually requires status checks (otherwise auto-merge would merge
#     at once, untested).
#
# --dry-run prints the verdict and changes nothing.
# The token comes from the git credential helper and is never printed.
set -euo pipefail
cd "$(dirname "$0")/.."

REPO="tomkazhikkachalil/edge-athlete"
API="https://api.github.com/repos/$REPO"

usage() { echo "usage: bash scripts/automerge-pr.sh <PR number> [--dry-run]" >&2; exit 2; }
PR="${1:-}"
[[ "$PR" =~ ^[0-9]+$ ]] || usage
DRY=0
[ "${2:-}" = "--dry-run" ] && DRY=1
[ -n "${2:-}" ] && [ "$DRY" = 0 ] && usage

TOKEN="$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null | sed -n 's/^password=//p')"
[ -n "$TOKEN" ] || { echo "✗ no GitHub token from the git credential helper" >&2; exit 1; }

gh_get() { curl -sS -H "Authorization: token $TOKEN" -H "Accept: application/vnd.github+json" "$API$1"; }
json() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }
refuse() { echo "✗ auto-merge not turned on: $1" >&2; exit 1; }

pr="$(gh_get "/pulls/$PR")"
[ "$(printf '%s' "$pr" | json "d.get('state')")" = "open" ] || refuse "PR #$PR is not open"
[ "$(printf '%s' "$pr" | json "d.get('draft')")" = "False" ] || refuse "PR #$PR is a draft"
[ "$(printf '%s' "$pr" | json "d['base']['repo']['full_name']")" = "$REPO" ] || refuse "PR #$PR is not against $REPO"
[ "$(printf '%s' "$pr" | json "d['base']['ref']")" = "main" ] || refuse "PR #$PR does not target main"
NODE="$(printf '%s' "$pr" | json "d['node_id']")"
echo "▸ PR #$PR — $(printf '%s' "$pr" | json "d['title']")"

# A migration never merges by itself. Every page of the file list is read.
page=1
while :; do
  files="$(gh_get "/pulls/$PR/files?per_page=100&page=$page")"
  hit="$(printf '%s' "$files" | json "next((f['filename'] for f in d if f['filename'].startswith('database/migrations/')), '')")"
  [ -z "$hit" ] || refuse "it carries a migration ($hit) — run it on production first, then: bash scripts/merge-pr.sh $PR"
  [ "$(printf '%s' "$files" | json "len(d)")" = "100" ] || break
  page=$((page + 1))
done

# main must require checks, or GitHub would merge at once.
required="$(gh_get "/branches/main/protection/required_status_checks" | json "','.join(sorted(d.get('contexts', [])))")"
for need in guardrails smoke verify; do
  case ",$required," in *",$need,"*) ;; *) refuse "main does not require the '$need' check (has: ${required:-none})" ;; esac
done

if [ "$DRY" = 1 ]; then echo "✓ dry run: PR #$PR would get auto-merge (no migration; main requires $required)"; exit 0; fi

out="$(curl -sS -X POST -H "Authorization: bearer $TOKEN" https://api.github.com/graphql \
  -d "{\"query\":\"mutation { enablePullRequestAutoMerge(input: {pullRequestId: \\\"$NODE\\\", mergeMethod: MERGE}) { pullRequest { autoMergeRequest { enabledAt } } } }\"}")"
err="$(printf '%s' "$out" | json "'; '.join(e.get('message', '') for e in d.get('errors', []))")"
[ -z "$err" ] || refuse "$err"
echo "✓ auto-merge is on for PR #$PR — GitHub merges it when verify, smoke and guardrails are green"
