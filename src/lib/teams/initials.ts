// A team's initials for its crest when it has no logo (sports-team website
// program, L2, Sep 27 2026). Age / tier tokens ("U13", "12U", "15A") are
// skipped so "U13 Blazers" reads "B", not "UB". Pure, zero imports.

export function teamInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const named = words.filter(w => !/^(u?\d+[a-z]?|\d+u)$/i.test(w));
  const pick = (named.length > 0 ? named : words).slice(0, 2);
  return pick.map(w => w[0]!.toUpperCase()).join('') || '?';
}
