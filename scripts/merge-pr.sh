#!/usr/bin/env bash
# merge-pr.sh — merge ONE pull request of this repo, but only when it is safe.
#
#   bash scripts/merge-pr.sh <PR number> [--no-wait]
#
# Refuses (exit 1, nothing merged) unless ALL of these hold:
#   • the PR is open, not a draft, and belongs to this repo;
#   • GitHub says it is mergeable (no conflicts);
#   • every check run on its head commit has COMPLETED and none failed
#     (success / skipped / neutral only), there is at least one, and the
#     commit's combined status is not failing;
# then merges with a merge commit (the house style), PINNED to the head sha
# it checked — a push that lands in between makes GitHub refuse the merge
# rather than merge untested code. When the base is main it then waits for
# Vercel's deployment status on the merge commit (skip with --no-wait).
#
# The token comes from the git credential helper (no gh CLI on this Mac —
# see memory); it is never printed. Exists so Claude Code can be allowed
# exactly this one command (`Bash(bash scripts/merge-pr.sh *)`) instead of
# raw curl.
set -euo pipefail
cd "$(dirname "$0")/.."

REPO="tomkazhikkachalil/edge-athlete"
API="https://api.github.com/repos/$REPO"

usage() { echo "usage: bash scripts/merge-pr.sh <PR number> [--no-wait]" >&2; exit 2; }
PR="${1:-}"
[[ "$PR" =~ ^[0-9]+$ ]] || usage
WAIT=1
[ "${2:-}" = "--no-wait" ] && WAIT=0
[ -n "${2:-}" ] && [ "$WAIT" = 1 ] && usage

TOKEN="$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null | sed -n 's/^password=//p')"
[ -n "$TOKEN" ] || { echo "✗ no GitHub token from the git credential helper" >&2; exit 1; }

gh_api() { # <method> <path> [json body]
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -sS -X "$method" -H "Authorization: token $TOKEN" -H "Accept: application/vnd.github+json" "$API$path" -d "$body"
  else
    curl -sS -X "$method" -H "Authorization: token $TOKEN" -H "Accept: application/vnd.github+json" "$API$path"
  fi
}
json() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }
refuse() { echo "✗ not merged: $1" >&2; exit 1; }

# 1. The PR: open, not a draft, mergeable (GitHub computes it lazily — poll).
for attempt in 1 2 3 4 5 6; do
  pr="$(gh_api GET "/pulls/$PR")"
  mergeable="$(printf '%s' "$pr" | json "d.get('mergeable')")"
  [ "$mergeable" != "None" ] && break
  sleep 3
done
state="$(printf '%s' "$pr" | json "d.get('state')")"
[ "$state" = "open" ] || refuse "PR #$PR is $state"
[ "$(printf '%s' "$pr" | json "d.get('draft')")" = "False" ] || refuse "PR #$PR is a draft"
[ "$(printf '%s' "$pr" | json "d['base']['repo']['full_name']")" = "$REPO" ] || refuse "PR #$PR is not against $REPO"
[ "$mergeable" = "True" ] || refuse "PR #$PR is not mergeable (conflicts, or GitHub has not decided: $mergeable)"
SHA="$(printf '%s' "$pr" | json "d['head']['sha']")"
BASE="$(printf '%s' "$pr" | json "d['base']['ref']")"
TITLE="$(printf '%s' "$pr" | json "d['title']")"
echo "▸ PR #$PR — $TITLE"
echo "  base $BASE · head ${SHA:0:8}"

# 2. The checks on that exact commit: all completed, none failed, at least one.
checks="$(gh_api GET "/commits/$SHA/check-runs?per_page=100")"
verdict="$(printf '%s' "$checks" | python3 -c "
import json,sys
runs=json.load(sys.stdin).get('check_runs',[])
pending=[r['name'] for r in runs if r['status']!='completed']
failed=[f\"{r['name']}={r['conclusion']}\" for r in runs if r['status']=='completed' and r['conclusion'] not in ('success','skipped','neutral')]
if not runs: print('NONE')
elif pending: print('PENDING '+', '.join(pending))
elif failed: print('FAILED '+', '.join(failed))
else: print(f'OK {len(runs)}')
")"
case "$verdict" in
  OK*) echo "  checks: ${verdict#OK } passed" ;;
  NONE) refuse "no check runs on ${SHA:0:8} yet — CI has not started" ;;
  PENDING*) refuse "checks still running: ${verdict#PENDING }" ;;
  *) refuse "checks failed: ${verdict#FAILED }" ;;
esac
combined="$(gh_api GET "/commits/$SHA/status" | json "d.get('state')")"
if [ "$combined" = "failure" ] || [ "$combined" = "error" ]; then refuse "commit status is $combined"; fi

# 3. Merge, pinned to the sha the checks ran on.
result="$(gh_api PUT "/pulls/$PR/merge" "{\"merge_method\":\"merge\",\"sha\":\"$SHA\"}")"
merged="$(printf '%s' "$result" | json "d.get('merged')")"
[ "$merged" = "True" ] || refuse "GitHub refused the merge: $(printf '%s' "$result" | json "d.get('message')")"
MERGE_SHA="$(printf '%s' "$result" | json "d.get('sha')")"
echo "✓ merged PR #$PR into $BASE as ${MERGE_SHA:0:8}"

# 4. main deploys on Vercel — wait for its status on the merge commit.
if [ "$BASE" = "main" ] && [ "$WAIT" = 1 ]; then
  echo "▸ waiting for the Vercel deployment…"
  for attempt in $(seq 1 60); do
    v="$(gh_api GET "/commits/$MERGE_SHA/status" | python3 -c "
import json,sys
s=[x for x in json.load(sys.stdin).get('statuses',[]) if x['context'].lower().startswith('vercel')]
print(s[0]['state'] if s else 'none')
")"
    case "$v" in
      success) echo "✓ Vercel: deployment completed"; exit 0 ;;
      failure|error) echo "✗ Vercel: deployment $v — check the Vercel dashboard" >&2; exit 1 ;;
    esac
    sleep 15
  done
  echo "⚠ Vercel status still '$v' after 15 min — the merge stands; check the dashboard" >&2
fi
