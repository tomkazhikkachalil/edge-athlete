import type { PublicVenue } from '@/lib/org-sites/public-data';

/** A directions search for a venue (the contact card's fallback rule). */
export function venueDirectionsHref(v: PublicVenue): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([v.name, v.city, v.region, v.country].filter(Boolean).join(', '))}`;
}

/** Program 3, D1: `variant` list (today) or cards; `click` none (today) or directions. */
export default function VenuesList({ venues, variant = 'list', click = 'none' }: { venues: PublicVenue[]; variant?: 'list' | 'cards'; click?: 'none' | 'directions' }) {
  const name = (v: PublicVenue) =>
    click === 'directions' ? (
      <a href={venueDirectionsHref(v)} target="_blank" rel="noopener nofollow" className="text-sm font-medium text-brand-fg">
        {v.name}
        <span className="sr-only"> (directions, opens in a new tab)</span>
      </a>
    ) : (
      <p className="text-sm font-medium text-primary">{v.name}</p>
    );
  const body = (v: PublicVenue) => {
    const place = [v.city, v.region].filter(Boolean).join(', ');
    return (
      <>
        {name(v)}
        {place ? <p className="text-xs text-tertiary">{place}</p> : null}
        {v.facilities.length > 0 ? (
          <p className="text-xs text-secondary mt-0.5">
            {v.facilities.map(f => f.name).join(' · ')}
          </p>
        ) : null}
      </>
    );
  };
  if (variant === 'cards') {
    return (
      <ul className="mt-2 grid gap-2 sm:grid-cols-2" data-variant="cards">
        {venues.map(v => (
          <li key={v.id} className="rounded-lg border border-border bg-canvas px-3 py-2.5">
            {body(v)}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="mt-2 divide-y divide-border-subtle">
      {venues.map(v => (
        <li key={v.id} className="py-2.5">
          {body(v)}
        </li>
      ))}
    </ul>
  );
}
