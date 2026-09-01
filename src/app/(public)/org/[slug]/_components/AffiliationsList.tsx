import type { PublicAffiliation } from '@/lib/org-sites/public-data';

const TYPE_LABEL: Record<string, string> = {
  partner_of: 'Partner',
  member_of: 'Member',
  sanctioned_by: 'Sanctioned',
};

// Phase 6 R3: the league chain reads directionally — "Sanctioned by" the
// governing body above, "Sanctions" the leagues below.
const UP_LABEL: Record<string, string> = {
  partner_of: 'Partner of',
  member_of: 'Member of',
  sanctioned_by: 'Sanctioned by',
};
const DOWN_LABEL: Record<string, string> = {
  partner_of: 'Partner',
  member_of: 'Members include',
  sanctioned_by: 'Sanctions',
};

// Affiliations module: active affiliations only (the public branch of
// 118), name + geography + relationship label. No cross-links v1 — the
// public site stays self-contained.
export default function AffiliationsList({
  affiliations,
}: {
  affiliations: PublicAffiliation[];
}) {
  return (
    <ul className="mt-2 divide-y divide-border-subtle">
      {affiliations.map((a, i) => {
        const place = [a.city, a.region].filter(Boolean).join(', ');
        return (
          <li
            key={`${a.name}-${i}`}
            className="py-2 flex items-baseline justify-between gap-4"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-primary truncate">{a.name}</p>
              {place ? <p className="text-xs text-tertiary truncate">{place}</p> : null}
            </div>
            {a.affiliationType ? (
              <span className="text-xs text-muted shrink-0">
                {(a.direction === 'up'
                  ? UP_LABEL[a.affiliationType]
                  : a.direction === 'down'
                    ? DOWN_LABEL[a.affiliationType]
                    : TYPE_LABEL[a.affiliationType]) ?? null}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
