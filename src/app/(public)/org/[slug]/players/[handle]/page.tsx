import type { Metadata } from 'next';
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

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

export default async function OrgSitePlayerPage({ params }: PageParams) {
  const { slug, handle } = await params;
  const site = await requireSiteModule(slug, 'standings');
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
