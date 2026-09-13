import Image from 'next/image';
import { orgMediaUrl } from '@/lib/media/org-site-media';
import type { PublicSponsor } from '@/lib/org-sites/validate';
import { SPONSOR_TIERS, SPONSOR_TIER_LABELS, tierRank } from '@/lib/site-builder/display';
import ScrollStrip from './ScrollStrip';

// Sponsors module (phase 3 R3; logos in the cleanup round): manager-
// entered names, optionally linked and logo'd. Urls arrive https-
// validated at write AND re-checked by parseSponsors at render; logo
// paths are prefix-asserted at write and re-checked at render; external
// links carry noopener + nofollow. Program 3, D2: `variant` (list — today
// — grid, one row, carousel over ScrollStrip), `groupByTier` (one labelled
// group per tier present, the ladder's order, the tierless last),
// `logoSize`, `perRow` (the grid), `click` (link | none). The order is
// the caller's (WidgetBody sorts).

const LOGO_PX = { sm: 32, md: 48, lg: 64 } as const;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map(w => w[0])
    .join('')
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 2)
    .toUpperCase();
}

export default function SponsorsList({
  sponsors,
  siteId,
  variant = 'list',
  groupByTier = false,
  logoSize = 'sm',
  perRow = 3,
  click = 'link',
}: {
  sponsors: PublicSponsor[];
  siteId: string;
  variant?: 'list' | 'grid' | 'row' | 'carousel';
  groupByTier?: boolean;
  logoSize?: 'sm' | 'md' | 'lg';
  perRow?: number;
  click?: 'link' | 'none';
}) {
  const px = LOGO_PX[logoSize];
  const logo = (s: PublicSponsor, size: number = px) => {
    // orgMediaUrl re-asserts the site prefix — a foreign path yields null
    // and renders the initials tile instead.
    const src = s.logoPath ? orgMediaUrl(siteId, s.logoPath) : null;
    return src ? (
      <Image src={src} alt="" width={size} height={size} unoptimized className="rounded shrink-0 object-contain" />
    ) : (
      <span aria-hidden="true" className="inline-flex shrink-0 items-center justify-center rounded bg-surface-sunken font-semibold text-secondary" style={{ width: size, height: size, fontSize: Math.max(11, Math.round(size / 3)) }}>
        {initials(s.name)}
      </span>
    );
  };
  const name = (s: PublicSponsor, cls: string) =>
    click === 'link' && s.url ? (
      <a href={s.url} target="_blank" rel="noopener nofollow" className={`${cls} text-brand-fg`}>
        {s.name}
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    ) : (
      <span className={`${cls} text-primary`}>{s.name}</span>
    );
  const tile = (s: PublicSponsor, i: number) => (
    <div key={`${s.name}-${i}`} className="flex flex-col items-center gap-1.5 text-center">
      {logo(s, Math.max(px, 48))}
      {name(s, 'text-xs font-medium leading-tight')}
    </div>
  );

  const render = (items: PublicSponsor[]) => {
    switch (variant) {
      case 'grid':
        return (
          <div className="mt-2 grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(6, Math.max(2, perRow))}, minmax(0, 1fr))` }} data-variant="grid">
            {items.map(tile)}
          </div>
        );
      case 'row':
        return (
          <div className="mt-2 flex flex-nowrap items-start gap-4 overflow-x-auto pb-1" data-variant="row">
            {items.map((s, i) => (
              <div key={`${s.name}-${i}`} className="shrink-0">
                {tile(s, i)}
              </div>
            ))}
          </div>
        );
      case 'carousel':
        return (
          <ScrollStrip label="Sponsors" itemWidth={`${Math.max(px, 48) + 64}px`} testId="sponsors">
            {items.map(tile)}
          </ScrollStrip>
        );
      default:
        return (
          <ul className="mt-2 divide-y divide-border-subtle">
            {items.map((s, i) => (
              <li key={`${s.name}-${i}`} className="py-2 flex items-center gap-3">
                {logo(s)}
                {name(s, 'text-sm font-medium')}
              </li>
            ))}
          </ul>
        );
    }
  };

  if (!groupByTier) return render(sponsors);
  const groups = [...SPONSOR_TIERS.map(t => ({ key: t, label: SPONSOR_TIER_LABELS[t], items: sponsors.filter(s => s.tier === t) })), { key: 'other', label: 'Supporters', items: sponsors.filter(s => !s.tier) }]
    .filter(g => g.items.length > 0)
    .sort((a, b) => tierRank(a.key === 'other' ? undefined : a.key) - tierRank(b.key === 'other' ? undefined : b.key));
  return (
    <div className="space-y-4" data-sponsor-groups={groups.length}>
      {groups.map(g => (
        <section key={g.key} aria-label={g.label} data-sponsor-tier={g.key}>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-secondary">{g.label}</h3>
          {render(g.items)}
        </section>
      ))}
    </div>
  );
}
