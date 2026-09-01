// ── Slug identity policy (phase 6 R1) — pure, node-tested ───────────────────
// Tom's anti-squatting rule for the vanity namespace: an org's slug must
// be composed from the org's OWN identity — city/district + club name
// (+ optionally sport) — so nobody claims "knights" or "hockey" bare.
// "Kanata" + "Knights" (+ "Football") → kanata-knights,
// kanataknightsfootball. The org rows carry everything needed: name,
// sport_key, city, region (migration 113 shape).
//
// Verdicts:
//  * ok       — ≥2 identity tokens (or the whole slugified org name).
//  * flagged  — allowed but surfaced on the admin dashboard's flagged
//               list (exactly one identity token, and not generic).
//  * refused  — no identity tokens, or a bare/all-generic word (sport
//               names, org-type words); a city alone reads as one
//               identity token → 'flagged'.
// Reserved/format/availability checks are the caller's job (mint/claim
// paths); this module judges IDENTITY only.

export interface OrgIdentity {
  name: string;
  sportKey?: string | null;
  city?: string | null;
  region?: string | null;
}

export type SlugVerdict =
  | { verdict: 'ok' }
  | { verdict: 'flagged'; reason: string }
  | { verdict: 'refused'; reason: string };

/** Words that may never stand alone as a slug, even when they happen to
 *  appear in the org's name (a club literally named "Hockey" still can't
 *  own /hockey). */
const GENERIC_WORDS = new Set([
  // sports (SportRegistry keys + common display words)
  'baseball', 'basketball', 'football', 'golf', 'hockey', 'ice-hockey',
  'icehockey', 'soccer', 'swimming', 'tennis', 'track', 'field',
  'track-field', 'trackfield', 'volleyball', 'training', 'lacrosse',
  'rugby', 'cricket', 'softball', 'curling', 'skiing', 'skating',
  // org-type words
  'league', 'club', 'association', 'federation', 'union', 'academy',
  'athletics', 'sports', 'sport', 'minor', 'youth', 'junior', 'senior',
  'elite', 'rep', 'house', 'team', 'athletic',
]);

const STOP_WORDS = new Set(['the', 'of', 'and', 'de', 'du', 'la', 'le', 'les']);

function tokenize(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= 2 && !STOP_WORDS.has(t));
}

/** All identity tokens for the org: name words + city + region + sport
 *  (sport_key split on underscores: ice_hockey → ice, hockey). */
export function identityTokens(org: OrgIdentity): Set<string> {
  return new Set([
    ...tokenize(org.name),
    ...tokenize(org.city),
    ...tokenize(org.region),
    ...tokenize((org.sportKey ?? '').replace(/_/g, ' ')),
  ]);
}

/** Which identity tokens the slug contains. Tokens match on hyphen
 *  boundaries or as substrings of a run (kanataknights matches kanata +
 *  knights) — substring matching needs length ≥4 to avoid noise. */
function matchedTokens(slug: string, tokens: Set<string>): string[] {
  const parts = slug.split('-').filter(Boolean);
  const joined = parts.join('');
  const matched: string[] = [];
  for (const token of tokens) {
    if (parts.includes(token)) matched.push(token);
    else if (token.length >= 4 && joined.includes(token)) matched.push(token);
  }
  return matched;
}

export function judgeSlug(slug: string, org: OrgIdentity): SlugVerdict {
  const normalized = slug.toLowerCase();
  const parts = normalized.split('-').filter(Boolean);
  const tokens = identityTokens(org);
  const matched = matchedTokens(normalized, tokens);

  // A bare generic word never stands, identity or not.
  if (parts.length === 1 && GENERIC_WORDS.has(parts[0])) {
    return {
      verdict: 'refused',
      reason: `"${parts[0]}" is too generic to stand alone — add your city or club name`,
    };
  }
  // Every part generic (e.g. minor-hockey) is a squat too.
  if (parts.length > 0 && parts.every(p => GENERIC_WORDS.has(p))) {
    return {
      verdict: 'refused',
      reason: 'A slug needs your own name in it — generic words alone are not enough',
    };
  }

  if (matched.length >= 2) return { verdict: 'ok' };

  // Tom's rule is literal: city/district + club name. A slug carrying
  // only one identity token — even the whole name of a one-word club —
  // is allowed but FLAGGED for the admin list, never silently ok.
  if (matched.length === 1) {
    return {
      verdict: 'flagged',
      reason: `Only "${matched[0]}" ties this to your organization — consider adding your city or sport`,
    };
  }
  return {
    verdict: 'refused',
    reason: 'The slug must be built from your organization’s name, city or sport',
  };
}

/** Candidate suggestions from the identity, most specific combinations
 *  first, filtered to verdict 'ok'. Caller filters for
 *  availability/reservation/format. */
export function suggestSlugs(org: OrgIdentity): string[] {
  const name = tokenize(org.name).filter(t => !GENERIC_WORDS.has(t));
  const city = tokenize(org.city)[0];
  const sport = tokenize((org.sportKey ?? '').replace(/_/g, ' ')).pop();
  const nameJoined = name.join('-');
  const out: string[] = [];
  const push = (s: string | null | undefined) => {
    if (s && s.length >= 3 && s.length <= 63 && !out.includes(s)) out.push(s);
  };
  if (city && !nameJoined.includes(city)) push(`${city}-${nameJoined}`);
  push(nameJoined);
  if (sport) push(`${nameJoined}-${sport}`);
  if (city && sport && !nameJoined.includes(city)) push(`${city}-${nameJoined}-${sport}`);
  push(nameJoined.replace(/-/g, ''));
  return out.filter(s => judgeSlug(s, org).verdict === 'ok').slice(0, 6);
}
