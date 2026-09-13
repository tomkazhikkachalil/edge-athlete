import type { PublicAffiliation } from '@/lib/org-sites/public-data';

const TYPE_LABEL: Record<string, string> = {
  partner_of: 'Partner',
  member_of: 'Member',
  sanctioned_by: 'Sanctioned',
};

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

function relation(a: PublicAffiliation): string | null {
  if (!a.affiliationType) return null;
  return (a.direction === 'up' ? UP_LABEL[a.affiliationType] : a.direction === 'down' ? DOWN_LABEL[a.affiliationType] : TYPE_LABEL[a.affiliationType]) ?? null;
}

/** Program 3, D1: `variant` list (today) or badges. */
export default function AffiliationsList({
  affiliations,
  variant = 'list',
}: {
  affiliations: PublicAffiliation[];
  variant?: 'list' | 'badges';
}) {
  if (variant === 'badges') {
    return (
      <ul className="mt-2 flex flex-wrap gap-2" data-variant="badges">
        {affiliations.map((a, i) => {
          const rel = relation(a);
          return (
            <li key={`${a.name}-${i}`} className="inline-flex items-baseline gap-1.5 rounded-full border border-border bg-canvas px-3 py-1 text-sm">
              <span className="font-medium text-primary">{a.name}</span>
              {rel ? <span className="text-xs text-muted">{rel}</span> : null}
            </li>
          );
        })}
      </ul>
    );
  }
  return (
    <ul className="mt-2 divide-y divide-border-subtle">
      {affiliations.map((a, i) => {
        const place = [a.city, a.region].filter(Boolean).join(', ');
        const rel = relation(a);
        return (
          <li
            key={`${a.name}-${i}`}
            className="py-2 flex items-baseline justify-between gap-4"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium text-primary truncate">{a.name}</p>
              {place ? <p className="text-xs text-tertiary truncate">{place}</p> : null}
            </div>
            {rel ? <span className="text-xs text-muted shrink-0">{rel}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}
