import type { PublicVenue } from '@/lib/org-sites/public-data';

// Venues module: venue name, place line, facility names. Ids stay
// internal — nothing links out of the site v1.
export default function VenuesList({ venues }: { venues: PublicVenue[] }) {
  return (
    <ul className="mt-2 divide-y divide-border-subtle">
      {venues.map(v => {
        const place = [v.city, v.region].filter(Boolean).join(', ');
        return (
          <li key={v.id} className="py-2.5">
            <p className="text-sm font-medium text-primary">{v.name}</p>
            {place ? <p className="text-xs text-tertiary">{place}</p> : null}
            {v.facilities.length > 0 ? (
              <p className="text-xs text-secondary mt-0.5">
                {v.facilities.map(f => f.name).join(' · ')}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
