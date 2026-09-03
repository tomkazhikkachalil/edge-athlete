import type { Metadata } from 'next';
import { isMembersOnly } from '@/lib/org-sites/private';
import MembersOnlyPage from '../../_components/MembersOnlyPage';
import { notFound } from 'next/navigation';
import { getCachedPlayerPage, getCachedSite } from '@/lib/org-sites/cached';
import { formatDateRange } from '@/lib/competitions/golf-weeks';
import { appBaseUrl, siteAbsoluteUrl, siteBasePath } from '@/lib/org-sites/urls';
import { requireSiteModule } from '../../_components/require-module';

// ── /org/[slug]/players/[handle] — a PLAYER page (phase 8 P2) ──────────────
// The Tour-site shape: one member's season on this org's boards — rank,
// points, the weeks they played. Exists ONLY for a public, unsupervised,
// claimed profile (isPublicProfile — Tom's decision) with an approved entry
// in one of the org's public golf leaderboards; every other handle 404s
// indistinguishably (a private member, a foreign handle, a typo). Built
// from the public standings payload, so it can never show more than the
// boards do. No Person in JSON-LD, ever. Gated by the standings module.

export const revalidate = 300;

export function generateStaticParams(): { slug: string; handle: string }[] {
  return [];
}

const HANDLE_RE = /^[a-z0-9_.-]{1,40}$/i;

interface PageParams {
  params: Promise<{ slug: string; handle: string }>;
}

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { slug, handle } = await params;
  const site = await getCachedSite(slug);
  if (!site || !HANDLE_RE.test(handle)) return { title: 'Not found' };
  const player = await getCachedPlayerPage(slug, site.side, site.orgId, handle);
  if (!player) return { title: 'Not found' };
  const title = `${player.name} — ${site.orgName}`;
  const description = `${player.name}'s season with ${site.orgName} on Edge Athlete.`;
  const canonical = `${siteAbsoluteUrl(site)}/players/${encodeURIComponent(player.handle)}`;
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical, siteName: 'Edge Athlete', type: 'website', images: [`${siteAbsoluteUrl(site)}/card.png`] },
  };
}

/** P3: the handicap trend as a server-rendered inline SVG (no client lib;
 *  the (public) segment ships no JS for this). */
function TrendSvg({ series }: { series: { date: string; index: number }[] }) {
  const w = 320;
  const h = 96;
  const pad = 8;
  const xs = series.map((_, i) => (series.length === 1 ? w / 2 : pad + (i * (w - pad * 2)) / (series.length - 1)));
  const values = series.map(s => s.index);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  // Lower is better in golf: a falling line is the good direction, so the
  // axis is NOT inverted — a lower index sits lower on the chart.
  const ys = values.map(v => pad + ((v - min) / span) * (h - pad * 2));
  const points = xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="mt-2 w-full max-w-md h-24"
      role="img"
      aria-label={`Handicap index over ${series.length} counted rounds, from ${values[0]} to ${values[values.length - 1]}`}
      data-points={series.length}
    >
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" className="text-brand-fg" />
      {xs.map((x, i) => (
        // Keyed by position: keys ride the RSC payload, and a date key would
        // print a private round's date into the page source.
        <circle key={i} cx={x} cy={ys[i]} r="2.5" fill="currentColor" className="text-brand-fg" />
      ))}
    </svg>
  );
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

export default async function OrgSitePlayerPage({ params }: PageParams) {
  const { slug, handle } = await params;
  const site = await requireSiteModule(slug, 'standings');
  // Phase 9 V4: a private club renders the members-only panel here.
  if (isMembersOnly(site, 'standings')) return <MembersOnlyPage site={site} title={'Players'} what={'A player’s page'} />;
  if (!HANDLE_RE.test(handle)) notFound();
  const player = await getCachedPlayerPage(slug, site.side, site.orgId, handle);
  if (!player) notFound();

  const base = siteBasePath(site);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-primary">{player.name}</h1>
        <p className="mt-1 text-sm text-tertiary">{`Member of ${site.orgName}`}</p>
        <p className="mt-1 text-sm">
          <a href={`${appBaseUrl()}/u/${encodeURIComponent(player.handle)}`} className="text-brand-fg font-medium hover:underline">
            Athlete profile →
          </a>
        </p>
      </header>

      {/* P3 — the season at a glance (league play only). */}
      <section aria-label="Season" className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6">
        <h2 className="text-lg font-semibold text-primary">Season</h2>
        <dl className="mt-2 grid grid-cols-3 sm:grid-cols-6 gap-3 text-sm">
          <div>
            <dt className="text-xs text-muted">League rounds</dt>
            <dd className="font-semibold text-primary">{player.season.leagueRounds}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Wins</dt>
            <dd className="font-semibold text-primary">{player.season.wins}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Low gross (18)</dt>
            <dd className="font-semibold text-primary">{player.season.lowGross18 ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Low gross (9)</dt>
            <dd className="font-semibold text-primary">{player.season.lowGross9 ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Low net (18)</dt>
            <dd className="font-semibold text-primary">{player.season.lowNet18 ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Low net (9)</dt>
            <dd className="font-semibold text-primary">{player.season.lowNet9 ?? '—'}</dd>
          </div>
        </dl>
      </section>

      {player.handicap && (
        <section aria-label="Handicap" className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-primary">
            Handicap
            <span className="ml-2 text-base font-semibold text-brand-fg">{player.handicap.current}</span>
            {player.handicap.provisional ? (
              <span className="ml-2 align-middle inline-block rounded-full bg-surface-sunken px-2 py-0.5 text-[10px] font-semibold uppercase text-secondary">
                provisional
              </span>
            ) : null}
          </h2>
          <p className="text-xs text-muted">{`Index after each of the last ${player.handicap.series.length} counted rounds — lower is better.`}</p>
          {player.handicap.series.length >= 2 ? <TrendSvg series={player.handicap.series} /> : null}
        </section>
      )}

      {player.photos.length > 0 && (
        <section aria-label="Photos" className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6" data-player-photos={player.photos.length}>
          <h2 className="text-lg font-semibold text-primary">Photos</h2>
          <p className="text-xs text-muted">From public round posts, shared with the club.</p>
          <ul className="mt-2 grid grid-cols-3 sm:grid-cols-4 gap-2">
            {player.photos.map(photo => (
              <li key={photo.mediaId} className="min-w-0">
                {/* eslint-disable-next-line @next/next/no-img-element -- gate-checked streamer bytes; not an optimizable public asset */}
                <img src={photo.url} alt={[photo.courseName, photo.date].filter(Boolean).join(', ') || 'Round photo'} loading="lazy" className="aspect-square w-full object-cover rounded-lg border border-border" />
              </li>
            ))}
          </ul>
        </section>
      )}

      {player.recentRounds.length > 0 && (
        <section aria-label="Recent rounds" className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-primary">Recent rounds</h2>
          <p className="text-xs text-muted">Rounds shared publicly in the last year.</p>
          <div className="relative mt-2 overflow-x-auto">
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th scope="col" className="py-1.5 pr-3 font-medium">Date</th>
                  <th scope="col" className="py-1.5 px-2 font-medium">Course</th>
                  <th scope="col" className="py-1.5 px-2 font-medium text-right">Holes</th>
                  <th scope="col" className="py-1.5 px-2 font-medium text-right">Gross</th>
                  <th scope="col" className="py-1.5 pl-2 font-medium">Tee</th>
                </tr>
              </thead>
              <tbody>
                {player.recentRounds.map(r => (
                  <tr key={r.id} className="border-t border-border-subtle">
                    <td className="py-1.5 pr-3 text-primary">{r.date}</td>
                    <td className="py-1.5 px-2 text-secondary">{r.courseName ?? '—'}</td>
                    <td className="py-1.5 px-2 text-right text-secondary">{r.holes}</td>
                    <td className="py-1.5 px-2 text-right font-medium text-primary">{r.gross}</td>
                    <td className="py-1.5 pl-2 text-secondary">{r.tee ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {player.competitions.map(comp => (
        <section
          key={comp.competitionId}
          aria-label={comp.name}
          className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6"
        >
          <h2 className="text-lg font-semibold text-primary">
            {comp.name}
            {comp.seasonLabel ? <span className="text-sm font-normal text-muted"> · {comp.seasonLabel}</span> : null}
          </h2>
          <dl className="mt-2 grid grid-cols-3 gap-3 text-sm">
            <div>
              <dt className="text-xs text-muted">Position</dt>
              <dd className="font-semibold text-primary">
                {comp.rank === null ? '—' : `${ordinal(comp.rank)} of ${comp.of}`}
                {comp.movement !== null && comp.movement !== 0 ? (
                  <span className={`ml-1 text-xs ${comp.movement > 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                    {comp.movement > 0 ? `▲${comp.movement}` : `▼${Math.abs(comp.movement)}`}
                  </span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Points</dt>
              <dd className="font-semibold text-primary">{comp.points ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Rounds</dt>
              <dd className="font-semibold text-primary">{comp.played}</dd>
            </div>
          </dl>
          {/* The scroller is `relative` so the sr-only (absolute) header cell
              clips inside it instead of widening the document (the 375px rule). */}
          {comp.weeks.length > 0 && (
            <div className="relative mt-3 overflow-x-auto">
              <table className="w-full text-sm whitespace-nowrap">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th scope="col" className="py-1.5 pr-3 font-medium">Round</th>
                    <th scope="col" className="py-1.5 px-2 font-medium">Course</th>
                    <th scope="col" className="py-1.5 px-2 font-medium text-right">Gross</th>
                    <th scope="col" className="py-1.5 px-2 font-medium text-right">Net</th>
                    {comp.weeks.some(w => typeof w.points === 'number') && (
                      <th scope="col" className="py-1.5 px-2 font-medium text-right">PTS</th>
                    )}
                    <th scope="col" className="py-1.5 pl-2 font-medium text-right">
                      <span className="sr-only">Status</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {comp.weeks.map(w => (
                    <tr key={`${comp.competitionId}-${w.playFrom}-${w.round ?? ''}`} className="border-t border-border-subtle">
                      <td className="py-1.5 pr-3 font-medium text-primary">
                        {w.round ?? 'Round'}
                        <span className="block text-xs font-normal text-muted">{formatDateRange(w.playFrom, w.playTo)}</span>
                      </td>
                      <td className="py-1.5 px-2 text-secondary">{w.courseName ?? '—'}</td>
                      <td className="py-1.5 px-2 text-right text-secondary">{w.gross ?? '—'}</td>
                      <td className="py-1.5 px-2 text-right text-secondary">{w.net ?? '—'}</td>
                      {comp.weeks.some(x => typeof x.points === 'number') && (
                        <td className="py-1.5 px-2 text-right font-medium text-primary">{w.points ?? '—'}</td>
                      )}
                      <td className="py-1.5 pl-2 text-right text-xs text-muted">{w.status === 'posted' ? 'posted' : 'final'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-xs">
            <a href={`${base}/standings`} className="text-brand-fg font-medium hover:underline">
              Full standings →
            </a>
          </p>
        </section>
      ))}
    </div>
  );
}
