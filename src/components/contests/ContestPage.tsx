import Link from 'next/link';
import type { ContestAccess, ContestView } from '@/lib/competitions/contest-view';
import {
  contestHeadline,
  contestStatusLabel,
  contestWhen,
  contestWhere,
  PROVENANCE_LABEL,
} from '@/lib/competitions/contest-format';

// ── The contest page body (Contest Place E1) ──────────────────────────────
// Props-only and server-safe: no hooks, no next/headers, no Font Awesome,
// no 'use client' — the in-app page renders it on the server for a public
// competition, the client gate island renders it after its fetch for a
// private one, and the org-site twin (E4) renders it under (public). It
// lives under src/components (not the (app) tree) for exactly that reason.
// Every hostname-dependent link comes through `links`, so the same body
// serves the app and a custom domain. Sections stack at every width;
// tables scroll inside their own overflow container (the PointsRaceTable
// rule); the section nav is plain anchors, so `#stats` is a deep link with
// zero JavaScript.

export interface ContestLinks {
  /** The org's page. */
  org: string;
  standings: string;
  /** A public athlete's page; null hides the link. */
  player: (handle: string) => string | null;
  /** The live round; null hides the section. */
  live: (groupPostId: string) => string | null;
  /** E4: the contest's org-site twin, when the org has a published site
   *  (in-app only; the twin itself passes nothing). */
  publicSite?: string | null;
}

interface Props {
  view: ContestView;
  access: ContestAccess;
  links: ContestLinks;
  /** The "Posts from this event" body (a client island in the app; omitted
   *  where there is none). Rendered only when the view counts posts. */
  postsSlot?: React.ReactNode;
}

const STATUS_TONE: Record<string, string> = {
  completed: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-900',
  in_progress: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900',
  canceled: 'bg-red-50 text-red-800 border-red-200 dark:bg-red-950/40 dark:text-red-200 dark:border-red-900',
  postponed: 'bg-red-50 text-red-800 border-red-200 dark:bg-red-950/40 dark:text-red-200 dark:border-red-900',
};

function Name({ name, handle, links }: { name: string; handle: string | null; links: ContestLinks }) {
  const href = handle ? links.player(handle) : null;
  return href ? (
    <Link href={href} className="text-brand-fg hover:text-brand-fg-strong font-medium">
      {name}
    </Link>
  ) : (
    <span className="font-medium text-primary">{name}</span>
  );
}

function TierChip({ provenance, disputed }: { provenance: string; disputed?: boolean }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className="text-xs text-muted">{PROVENANCE_LABEL[provenance] ?? provenance}</span>
      {disputed && (
        <span className="text-xs px-1.5 py-0.5 rounded-md border border-amber-200 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-900">
          Unconfirmed
        </span>
      )}
    </span>
  );
}

export default function ContestPage({ view, access, links, postsSlot }: Props) {
  const { contest, competition, org, outcome } = view;
  const where = contestWhere(view);
  const liveRounds = view.liveRounds
    .map(r => ({ ...r, href: links.live(r.groupPostId) }))
    .filter((r): r is { groupPostId: string; label: string; href: string } => !!r.href);
  const showPosts = !!postsSlot && view.publicPostCount > 0;
  const presentStatKeys = view.statFields.filter(f => view.statLines.some(l => typeof l.stats[f.key] === 'number'));
  const sections = [
    { id: 'result', label: outcome.kind === 'leaderboard' ? 'Leaderboard' : 'Result', show: true },
    { id: 'stats', label: 'Stats', show: view.statLines.length > 0 },
    { id: 'media', label: 'Media', show: view.media.length > 0 },
    { id: 'live', label: 'Live', show: liveRounds.length > 0 },
    { id: 'posts', label: 'Posts', show: showPosts },
  ].filter(s => s.show);

  return (
    <article className="space-y-6" data-contest-id={contest.id} data-contest-access={access}>
      <header className="bg-surface rounded-lg border border-border p-4 sm:p-6">
        <p className="text-xs text-muted">
          <Link href={links.org} className="hover:text-primary">{org.name}</Link>
          {' · '}
          <Link href={links.standings} className="hover:text-primary">{competition.name}</Link>
        </p>
        <h1 className="mt-1 text-xl sm:text-2xl font-bold text-primary break-words">{contestHeadline(view)}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span className={`px-2 py-0.5 rounded-md border ${STATUS_TONE[contest.status] ?? 'bg-surface-muted text-secondary border-border'}`}>
            {contestStatusLabel(contest.status)}
          </span>
          <span className="px-2 py-0.5 rounded-md border border-border text-secondary">{competition.sportName}</span>
          {competition.seasonLabel && (
            <span className="px-2 py-0.5 rounded-md border border-border text-secondary">{competition.seasonLabel}</span>
          )}
          {contest.round && outcome.kind === 'fixture' && (
            <span className="px-2 py-0.5 rounded-md border border-border text-secondary">{contest.round}</span>
          )}
        </div>
        <p className="mt-3 text-sm text-secondary">{contestWhen(view)}</p>
        {where && <p className="text-sm text-tertiary">{where}</p>}
        {links.publicSite && (
          <p className="mt-2 text-sm">
            <Link href={links.publicSite} className="text-brand-fg hover:text-brand-fg-strong font-medium inline-flex items-center min-h-[36px]" data-contest-public-site="">
              Public page →
            </Link>
          </p>
        )}
        {sections.length > 1 && (
          <nav aria-label="Sections" className="mt-4 -mx-1 overflow-x-auto">
            <ul className="flex gap-1 px-1">
              {sections.map(s => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className="inline-flex items-center min-h-[36px] px-3 rounded-md text-sm font-medium text-secondary hover:bg-surface-muted whitespace-nowrap"
                  >
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </header>

      <section id="result" aria-label={outcome.kind === 'leaderboard' ? 'Leaderboard' : 'Result'} className="bg-surface rounded-lg border border-border p-4 sm:p-6 scroll-mt-4">
        {outcome.kind === 'fixture' && (
          <div>
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
              {[outcome.home, outcome.away].map((s, i) => {
                const entrant = s ? view.entrants.find(e => e.participantId === s.participantId) : null;
                const won = !!s && outcome.winnerEntryId === s.entryId;
                return (
                  <div key={s?.participantId ?? i} className={`min-w-0 ${i === 0 ? 'text-left' : 'text-right'}`}>
                    <p className={`text-base sm:text-lg break-words ${won ? 'font-bold text-primary' : 'font-medium text-secondary'}`}>
                      {s ? <Name name={s.name} handle={entrant?.handle ?? null} links={links} /> : 'TBD'}
                    </p>
                    <p className="text-3xl sm:text-4xl font-bold text-primary tabular-nums" data-contest-score={i === 0 ? 'home' : 'away'}>
                      {s?.score ?? '–'}
                    </p>
                    {entrant?.result && (
                      <TierChip provenance={entrant.result.provenance} disputed={entrant.result.disputeStatus === 'disputed'} />
                    )}
                  </div>
                );
              }).flatMap((node, i) => (i === 0 ? [node, <span key="vs" className="text-sm text-muted">vs</span>] : [node]))}
            </div>
            <p className="mt-3 text-sm text-tertiary">
              {outcome.complete
                ? outcome.tie
                  ? 'Final · tie'
                  : `Final · ${outcome.scoreline}`
                : outcome.scoreline
                  ? `${outcome.scoreline} · ${contestStatusLabel(contest.status)}`
                  : 'No score yet'}
            </p>
          </div>
        )}

        {outcome.kind === 'leaderboard' && (
          outcome.rows.length === 0 ? (
            <p className="text-sm text-tertiary">No entrants yet.</p>
          ) : (
            <div className="overflow-x-auto -mx-4 sm:mx-0">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted border-b border-border">
                    <th className="px-4 sm:px-2 py-2 font-medium w-10">#</th>
                    <th className="px-2 py-2 font-medium">{competition.entrantType === 'team' ? 'Team' : 'Player'}</th>
                    {outcome.columns.map(c => (
                      <th key={c.key} className="px-2 py-2 font-medium text-right" title={c.label}>{c.shortLabel}</th>
                    ))}
                    <th className="px-2 py-2 font-medium text-right sm:pr-2 pr-4">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {outcome.rows.map(r => {
                    const entrant = view.entrants.find(e => e.participantId === r.participantId);
                    return (
                      <tr key={r.participantId} className="border-b border-border-subtle last:border-0" data-contest-row={r.entryId}>
                        <td className="px-4 sm:px-2 py-2 tabular-nums text-secondary">{r.rank ?? '–'}</td>
                        <td className="px-2 py-2 min-w-0">
                          <Name name={r.name} handle={entrant?.handle ?? null} links={links} />
                        </td>
                        {outcome.columns.map(c => (
                          <td key={c.key} className="px-2 py-2 text-right tabular-nums text-primary">
                            {c.key === 'score' ? (r.score ?? '–') : (r.stats[c.key] ?? '–')}
                          </td>
                        ))}
                        <td className="px-2 py-2 text-right sm:pr-2 pr-4">
                          {entrant?.result ? (
                            <TierChip provenance={entrant.result.provenance} disputed={entrant.result.disputeStatus === 'disputed'} />
                          ) : (
                            <span className="text-xs text-muted">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        )}

        {outcome.kind === 'unscored' && (
          <p className="text-sm text-tertiary">This format has no result view yet.</p>
        )}
      </section>

      {view.statLines.length > 0 && (
        <section id="stats" aria-label="Stats" className="bg-surface rounded-lg border border-border p-4 sm:p-6 scroll-mt-4">
          <h2 className="text-lg font-semibold text-primary mb-3">Stats</h2>
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-border">
                  <th className="px-4 sm:px-2 py-2 font-medium">Player</th>
                  {competition.entrantType === 'team' && <th className="px-2 py-2 font-medium">Team</th>}
                  {presentStatKeys.map(f => (
                    <th key={f.key} className="px-2 py-2 font-medium text-right" title={f.label}>{f.shortLabel}</th>
                  ))}
                  <th className="px-2 py-2 font-medium text-right sm:pr-2 pr-4">Source</th>
                </tr>
              </thead>
              <tbody>
                {view.statLines.map((l, i) => (
                  <tr key={i} className="border-b border-border-subtle last:border-0">
                    <td className="px-4 sm:px-2 py-2"><Name name={l.name} handle={l.handle} links={links} /></td>
                    {competition.entrantType === 'team' && <td className="px-2 py-2 text-secondary">{l.teamName ?? '—'}</td>}
                    {presentStatKeys.map(f => (
                      <td key={f.key} className="px-2 py-2 text-right tabular-nums text-primary">{l.stats[f.key] ?? '–'}</td>
                    ))}
                    <td className="px-2 py-2 text-right sm:pr-2 pr-4"><TierChip provenance={l.provenance} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {view.media.length > 0 && (
        <section id="media" aria-label="Media" className="bg-surface rounded-lg border border-border p-4 sm:p-6 scroll-mt-4">
          <h2 className="text-lg font-semibold text-primary mb-3">Media</h2>
          <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {view.media.map(m => (
              <li key={m.id}>
                {m.mediaType === 'image' ? (
                  // eslint-disable-next-line @next/next/no-img-element -- gate-checked streamer bytes; not an optimizable public asset
                  <img
                    src={m.url}
                    alt={m.caption ?? `${competition.name} photo`}
                    loading="lazy"
                    className="aspect-square w-full object-cover rounded-lg border border-border"
                  />
                ) : (
                  <video src={m.url} controls preload="metadata" className="aspect-square w-full object-cover rounded-lg border border-border" />
                )}
                {m.caption && <p className="mt-1 text-xs text-muted truncate">{m.caption}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {liveRounds.length > 0 && (
        <section id="live" aria-label="Live rounds" className="bg-surface rounded-lg border border-border p-4 sm:p-6 scroll-mt-4">
          <h2 className="text-lg font-semibold text-primary mb-1">{liveRounds.length === 1 ? 'Live round' : 'Live rounds'}</h2>
          <p className="text-sm text-tertiary mb-3">The scorecards these results were counted from.</p>
          <ul className="flex flex-wrap gap-2">
            {liveRounds.map(r => (
              <li key={r.groupPostId}>
                <Link href={r.href} className="inline-flex items-center min-h-[44px] px-4 rounded-lg bg-brand text-white font-semibold hover:bg-brand-hover" data-contest-live={r.groupPostId}>
                  {r.label} →
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {showPosts && (
        <section id="posts" aria-label="Posts from this event" className="bg-surface rounded-lg border border-border p-4 sm:p-6 scroll-mt-4" data-contest-posts={view.publicPostCount}>
          <h2 className="text-lg font-semibold text-primary mb-1">Posts from this event</h2>
          <p className="text-sm text-tertiary mb-3">Public posts whose rounds were counted here.</p>
          {postsSlot}
        </section>
      )}

      <footer className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <Link href={links.standings} className="text-brand-fg hover:text-brand-fg-strong font-medium min-h-[44px] inline-flex items-center">
          Standings →
        </Link>
        <Link href={links.org} className="text-secondary hover:text-primary min-h-[44px] inline-flex items-center">
          {org.name}
        </Link>
      </footer>
    </article>
  );
}
