import Image from 'next/image';
import { orgMediaUrl } from '@/lib/media/org-site-media';
import type { PublicSponsor } from '@/lib/org-sites/validate';

// Sponsors module (phase 3 R3; logos in the cleanup round): manager-
// entered names, optionally linked and logo'd. Urls arrive https-
// validated at write AND re-checked by parseSponsors at render; logo
// paths are prefix-asserted at write and re-checked at render; external
// links carry noopener + nofollow.
export default function SponsorsList({
  sponsors,
  siteId,
}: {
  sponsors: PublicSponsor[];
  siteId: string;
}) {
  return (
    <ul className="mt-2 divide-y divide-border-subtle">
      {sponsors.map((s, i) => {
        // orgMediaUrl re-asserts the site prefix — a foreign path yields
        // null and simply renders no logo.
        const logoSrc = s.logoPath ? orgMediaUrl(siteId, s.logoPath) : null;
        return (
        <li key={`${s.name}-${i}`} className="py-2 flex items-center gap-3">
          {logoSrc && (
            <Image
              src={logoSrc}
              alt=""
              width={32}
              height={32}
              unoptimized
              className="rounded shrink-0"
            />
          )}
          {s.url ? (
            <a
              href={s.url}
              target="_blank"
              rel="noopener nofollow"
              className="text-sm font-medium text-brand-fg"
            >
              {s.name}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : (
            <span className="text-sm font-medium text-primary">{s.name}</span>
          )}
        </li>
        );
      })}
    </ul>
  );
}
