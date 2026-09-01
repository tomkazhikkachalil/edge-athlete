import type { PublicSponsor } from '@/lib/org-sites/validate';

// Sponsors module (phase 3 R3): manager-entered names, optionally linked.
// Urls arrive https-validated at write AND re-checked by parseSponsors at
// render; external links carry noopener + nofollow. Plain text names —
// sponsor LOGOS wait for a later round.
export default function SponsorsList({ sponsors }: { sponsors: PublicSponsor[] }) {
  return (
    <ul className="mt-2 divide-y divide-border-subtle">
      {sponsors.map((s, i) => (
        <li key={`${s.name}-${i}`} className="py-2">
          {s.url ? (
            <a
              href={s.url}
              target="_blank"
              rel="noopener nofollow"
              className="text-sm font-medium text-brand-fg"
            >
              {s.name}
            </a>
          ) : (
            <span className="text-sm font-medium text-primary">{s.name}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
