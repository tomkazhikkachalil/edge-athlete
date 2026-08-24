// ── Place aliases (pure) ────────────────────────────────────────────────────
// GeoNames names New York "New York City", Montréal "Montréal", and its
// `alternatenames` column carries what people actually type: "New York",
// "NYC", "Big Apple", "Nueva York", "Monreal". The free-text backfill and the
// place picker match those through `place_aliases` (migration 109), seeded
// from this rule. Kept pure so the rule is tested, not guessed.

const MAX_ALIASES_PER_PLACE = 60;
const MAX_ALIAS_LENGTH = 40;

/** Fold to the shape `search_normalize` produces in SQL: lower, accents off,
 *  only letters/digits/spaces and the punctuation that appears in place names. */
export function foldAlias(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 .'-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Latin-script alternate names worth keeping for one place: those sharing
 *  a token with the place's own name first, then shortest first (so "New
 *  York" and "NYC" survive the per-place cap before the 60 other spellings
 *  of New York City), minus the place's own name/ASCII name.
 *  Non-Latin scripts are dropped: a Cyrillic or CJK alias can't match a
 *  `search_normalize`d query, so it would only be dead weight. */
export function selectPlaceAliases(
  name: string,
  asciiName: string | null | undefined,
  alternatenames: string | null | undefined
): string[] {
  const own = new Set([foldAlias(name), foldAlias(asciiName ?? '')].filter(Boolean));
  // Tokens of the place's own name: an alias sharing one ("New York",
  // "Nueva York", "City of New York") is what people type; transliterations
  // ("Aebura", "nyuyog") come after, so the per-place cap keeps the right ones.
  const ownTokens = new Set([...own].flatMap(n => n.split(' ')).filter(t => t.length > 2));
  const seen = new Set<string>();
  const out: { alias: string; norm: string; related: number }[] = [];
  for (const raw of (alternatenames ?? '').split(',')) {
    const alias = raw.trim();
    if (!alias) continue;
    // Latin letters (with accents), digits, space and name punctuation only.
    const stripped = alias.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (!/^[A-Za-z0-9 .'-]{2,40}$/.test(stripped)) continue;
    const norm = foldAlias(alias);
    if (!norm || norm.length < 2 || norm.length > MAX_ALIAS_LENGTH) continue;
    if (own.has(norm) || seen.has(norm)) continue;
    seen.add(norm);
    const related = norm.split(' ').some(t => ownTokens.has(t)) ? 0 : 1;
    out.push({ alias: stripped.replace(/\s+/g, ' ').trim(), norm, related });
  }
  out.sort((a, b) => a.related - b.related || a.norm.length - b.norm.length || a.norm.localeCompare(b.norm));
  return out.slice(0, MAX_ALIASES_PER_PLACE).map(a => a.alias);
}
