'use client';

/**
 * Golf's sport profile ("one wave", phase 3 — docs/specs/sport-profile.md):
 * Career → Season (the calendar year) → Round → Hole, on the sport profile's
 * own page, tabs and addresses (`?season=2026&game=round:<id>&hole=7`). Every
 * step down is a link, so Back walks up. The numbers come folded from the
 * server (a hidden round counts and is never listed for anyone else); a
 * season's holes are read once, when a season is opened.
 */
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { Camera, Flag } from 'lucide-react';
import SectionEmptyState from '@/components/SectionEmptyState';
import RivalsPanel from '@/components/play/RivalsPanel';
import GolfBreakdown from '@/components/stats/GolfBreakdown';
import { frontBack, golfSeasonOf, holesOfKind, mediaCountByHole, mediaOfHole, pctText, SCORE_KINDS, scoreKindOf, toParText, type GolfHoleRow, type GolfMedia, type GolfRoundListed, type GolfTotals, type ScoreKind } from '@/lib/sport-profile/golf-rules';
import { sportViewSearch, type SportView } from '@/lib/sport-profile/view';
import GolfMediaGrid from './GolfMediaGrid';
import Tiles from './Tiles';
import type { GolfProfileData } from './types';

interface Props {
  profileId: string;
  data: GolfProfileData;
  view: SportView;
  /** The sport profile's own path (no query). */
  basePath: string;
}

const day = (date: string, long = false) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', long ? { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' } : { month: 'short', day: 'numeric', timeZone: 'UTC' });
const one = (n: number | null) => (n === null ? '—' : Number.isInteger(n) ? String(n) : n.toFixed(1));
const isKind = (v: string | null): v is ScoreKind => SCORE_KINDS.some(k => k.id === v);
const roundKey = (id: string) => `round:${id}`;
const KIND_WORD: Record<ScoreKind, string> = { eagle: 'Eagle or better', birdie: 'Birdie', par: 'Par', bogey: 'Bogey', double: 'Double or worse' };

function tilesOf(t: GolfTotals): Array<{ label: string; value: string | null }> {
  return [
    { label: 'Rounds', value: String(t.rounds) },
    { label: 'Scoring average', value: t.avg18 === null ? null : one(t.avg18) },
    { label: 'To par, per 18', value: t.toPar18 === null ? null : toParText(t.toPar18) },
    { label: 'Fairways', value: t.fairways.of > 0 ? pctText(t.fairways) : null },
    { label: 'Greens in regulation', value: t.greens.of > 0 ? pctText(t.greens) : null },
    { label: 'Putts, per 18', value: t.putts18 === null ? null : one(t.putts18) },
  ];
}

/** The repo's table idiom: a horizontal scroller on a phone, the first column pinned. */
function Table({ caption, head, rows, foot }: { caption: string; head: string[]; rows: Array<{ id: string; cells: ReactNode[] }>; foot?: ReactNode[] }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <table className="w-full min-w-max border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted">
            {head.map((h, i) => <th key={h} scope="col" className={`whitespace-nowrap py-2 pr-4 font-medium ${i === 0 ? 'sticky left-0 bg-surface' : 'text-right tabular-nums'}`}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} className="border-b border-border-subtle" data-golf-row={r.id}>
              {r.cells.map((c, i) => i === 0
                ? <th key={i} scope="row" className="sticky left-0 whitespace-nowrap bg-surface py-1 pr-4 text-left font-medium text-primary">{c}</th>
                : <td key={i} className="whitespace-nowrap py-1 pr-4 text-right tabular-nums text-primary">{c}</td>)}
            </tr>
          ))}
        </tbody>
        {foot && (
          <tfoot>
            <tr className="font-semibold" data-golf-row="total">
              {foot.map((c, i) => i === 0
                ? <th key={i} scope="row" className="sticky left-0 whitespace-nowrap bg-surface py-2 pr-4 text-left text-primary">{c}</th>
                : <td key={i} className="whitespace-nowrap py-2 pr-4 text-right tabular-nums text-primary">{c}</td>)}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

const door = 'ea-interactive inline-flex min-h-[44px] items-center rounded underline decoration-border underline-offset-4';
const backLink = 'ea-interactive inline-flex min-h-[44px] items-center gap-2 rounded-lg text-sm font-medium text-brand-fg';

function totalsCells(t: GolfTotals, best: ReactNode): ReactNode[] {
  return [t.rounds, one(t.avg18), toParText(t.toPar18), best, pctText(t.fairways), pctText(t.greens), one(t.putts18)];
}

type Holes = { year: string; state: 'loading' | 'error' } | { year: string; state: 'ready'; byRound: Record<string, GolfHoleRow[]>; media: GolfMedia[]; official: string[] };

export default function GolfProfile({ profileId, data, view, basePath }: Props) {
  const roundId = view.game?.startsWith('round:') ? view.game.slice(6) : null;
  const round = roundId ? data.rounds.find(r => r.id === roundId) ?? null : null;
  const year = view.season ?? (round ? golfSeasonOf(round.date) : null);
  const href = (v: Partial<SportView>) => `${basePath}${sportViewSearch(v)}`;

  // A season's holes, read once when a season (or anything under it) is open.
  const [holes, setHoles] = useState<Holes | null>(null);
  if (year && holes?.year !== year) setHoles({ year, state: 'loading' });
  useEffect(() => {
    if (!year) return;
    let cancelled = false;
    fetch(`/api/profile/${profileId}/sport-profile?sport=golf&holes=${year}`, { credentials: 'include' })
      .then(async r => {
        if (!r.ok) throw new Error(String(r.status));
        return (await r.json()) as { holes?: Record<string, GolfHoleRow[]>; media?: GolfMedia[]; official?: string[] };
      })
      .then(body => { if (!cancelled) setHoles({ year, state: 'ready', byRound: body.holes ?? {}, media: body.media ?? [], official: body.official ?? [] }); })
      .catch(() => { if (!cancelled) setHoles({ year, state: 'error' }); });
    return () => { cancelled = true; };
  }, [profileId, year]);
  const byRound = holes?.state === 'ready' && holes.year === year ? holes.byRound : null;
  const media = holes?.state === 'ready' && holes.year === year ? holes.media : [];
  const official = holes?.state === 'ready' && holes.year === year ? holes.official : [];
  const holesNote = holes?.state === 'error'
    ? <p className="text-sm text-secondary" role="alert">The scorecards could not be loaded. Check your connection and try again.</p>
    : <div className="min-h-[20vh]" aria-busy="true" data-golf-holes-loading="" />;

  if (data.rounds.length === 0 && data.career.rounds === 0) {
    return <SectionEmptyState icon={Flag} title="No golf rounds yet" body="This fills in on its own: every round played or posted adds its score, its holes and its numbers here." />;
  }

  // ── Round and Hole ──────────────────────────────────────────────────────────
  if (roundId) {
    const seasonHref = year ? href({ season: year }) : basePath;
    if (!round) {
      return (
        <section className="space-y-4" data-sport-level="game">
          <Link href={seasonHref} className={backLink}><span aria-hidden="true">←</span> {year ?? 'Career'}</Link>
          <p className="text-secondary" data-golf-round-missing="">This round is not available.</p>
        </section>
      );
    }
    const card = byRound?.[round.id] ?? null;
    const roundHref = href({ season: year, game: roundKey(round.id) });
    const score = round.gross === null ? 'No score' : `${round.gross}${round.toPar === null ? '' : ` (${toParText(round.toPar)})`}`;

    if (view.hole) {
      const h = card?.find(x => x.n === view.hole) ?? null;
      const kind = h ? scoreKindOf(h.par, h.strokes) : null;
      const numbers = card?.map(x => x.n) ?? [];
      const at = numbers.indexOf(view.hole);
      return (
        <section className="space-y-6" data-sport-level="hole" data-golf-hole={view.hole}>
          <Link href={roundHref} className={backLink} data-golf-up="round"><span aria-hidden="true">←</span> {round.course}, {day(round.date)}</Link>
          <h2 className="text-lg font-bold text-primary">Hole {view.hole}{h?.par ? ` · Par ${h.par}${h.parEst ? ' (est.)' : ''}` : ''}</h2>
          {!card && holesNote}
          {card && !h && <p className="text-secondary" data-golf-hole-missing="">This hole was not recorded in this round.</p>}
          {h && (
            <>
              <Tiles tiles={[
                { label: 'Score', value: h.strokes === null ? null : `${h.strokes}${kind ? ` · ${KIND_WORD[kind]}` : ''}` },
                { label: 'Putts', value: h.putts === null ? null : String(h.putts) },
                { label: 'Fairway', value: h.fairway === null || (h.par ?? 0) < 4 ? null : h.fairway ? 'Hit' : 'Missed' },
                { label: 'Green in regulation', value: h.green === null ? null : h.green ? 'Yes' : 'No' },
                { label: 'Penalties', value: h.penalties > 0 ? String(h.penalties) : null },
              ]} />
              {mediaOfHole(media, round.id, view.hole).length > 0 && (
                <div data-golf-hole-media="">
                  <h3 className="mb-2 text-base font-bold text-primary">Photos and clips</h3>
                  <GolfMediaGrid media={mediaOfHole(media, round.id, view.hole)} describe={() => `Hole ${view.hole}, ${round.course}, ${day(round.date, true)}`} />
                </div>
              )}
              <nav aria-label="Holes" className="flex justify-between gap-3">
                {at > 0 ? <Link href={href({ season: year, game: roundKey(round.id), hole: numbers[at - 1] })} className={backLink} data-golf-hole-prev=""><span aria-hidden="true">←</span> Hole {numbers[at - 1]}</Link> : <span />}
                {at >= 0 && at < numbers.length - 1 ? <Link href={href({ season: year, game: roundKey(round.id), hole: numbers[at + 1] })} className={backLink} data-golf-hole-next="">Hole {numbers[at + 1]} <span aria-hidden="true">→</span></Link> : <span />}
              </nav>
            </>
          )}
        </section>
      );
    }

    const nines = card ? frontBack(card) : null;
    const mediaCount = mediaCountByHole(media, round.id);
    const roundMedia = media.filter(m => m.roundId === round.id);
    return (
      <section className="space-y-6" data-sport-level="game" data-golf-round={round.id}>
        <Link href={seasonHref} className={backLink} data-golf-up="season"><span aria-hidden="true">←</span> {year}</Link>
        <div>
          <h2 className="text-lg font-bold text-primary">{round.course}</h2>
          <p className="text-sm text-secondary">
            {day(round.date, true)}{round.tee ? ` · ${round.tee} tees` : ''} · {round.holes} holes
            {official.includes(round.id) && <span className="ml-2 rounded bg-brand-soft px-1.5 py-0.5 text-xs font-semibold text-brand-fg" data-golf-official="">Official event round</span>}
            {round.hidden && <span className="ml-2 rounded bg-surface-sunken px-1.5 py-0.5 text-xs font-semibold text-secondary" data-golf-hidden="">Hidden from your profile</span>}
          </p>
        </div>
        <Tiles tiles={[
          { label: 'Score', value: score },
          { label: 'Front nine', value: nines?.front ? `${nines.front.strokes} (${toParText(nines.front.strokes - nines.front.par)})` : null },
          { label: 'Back nine', value: nines?.back ? `${nines.back.strokes} (${toParText(nines.back.strokes - nines.back.par)})` : null },
        ]} />
        {!card && holesNote}
        {card && card.length === 0 && <p className="text-sm text-muted" data-golf-no-holes="">This round was saved as a total: no hole-by-hole scores.</p>}
        {card && card.length > 0 && (
          <div>
            <h3 className="mb-2 text-base font-bold text-primary">Scorecard</h3>
            <Table
              caption={`Scorecard, ${round.course}, ${day(round.date, true)}`}
              head={['Hole', 'Par', 'Score', 'Putts', 'Fairway', 'Green']}
              rows={card.map(h => {
                const kind = scoreKindOf(h.par, h.strokes);
                return {
                  id: `hole-${h.n}`,
                  cells: [
                    <span key="n" className="inline-flex items-center gap-2">
                      <Link href={href({ season: year, game: roundKey(round.id), hole: h.n })} className={door} data-golf-hole-link={h.n}>Hole {h.n}</Link>
                      {mediaCount.has(h.n) && (
                        <span className="inline-flex items-center gap-1 text-xs text-muted" data-golf-hole-media-count={mediaCount.get(h.n)}>
                          <Camera className="h-3.5 w-3.5" aria-hidden="true" />
                          {mediaCount.get(h.n)}
                          <span className="sr-only"> photos and clips</span>
                        </span>
                      )}
                    </span>,
                    h.par == null ? '—' : h.parEst ? <span key="p" className="whitespace-nowrap" data-golf-par-estimated={h.n}>{h.par} (est.)</span> : h.par,
                    h.strokes === null ? '—' : <span title={kind ? KIND_WORD[kind] : undefined} className={kind === 'eagle' || kind === 'birdie' ? 'font-bold text-emerald-700 dark:text-emerald-400' : kind === 'double' ? 'font-bold text-red-600 dark:text-red-400' : ''} data-golf-kind={kind ?? undefined}>{h.strokes}</span>,
                    h.putts ?? '—',
                    h.fairway === null || (h.par ?? 0) < 4 ? '—' : h.fairway ? 'Hit' : 'Miss',
                    h.green === null ? '—' : h.green ? 'Yes' : 'No',
                  ],
                };
              })}
            />
          </div>
        )}
        {roundMedia.length > 0 && (
          <div data-golf-round-media="">
            <h3 className="mb-2 text-base font-bold text-primary">Photos and clips</h3>
            <GolfMediaGrid
              media={roundMedia}
              describe={m => `${m.n ? `Hole ${m.n}, ` : ''}${round.course}, ${day(round.date, true)}`}
              caption={m => (m.n ? { text: `Hole ${m.n}`, href: href({ season: year, game: roundKey(round.id), hole: m.n }) } : null)}
            />
          </div>
        )}
        {data.can_edit && (
          <Link href={`/app/sport/golf/rounds/${round.id}`} className="ea-interactive inline-flex min-h-[44px] items-center rounded-lg border border-border-strong px-4 text-sm font-semibold text-primary" data-golf-edit="">
            Edit this round
          </Link>
        )}
      </section>
    );
  }

  // ── Season ──────────────────────────────────────────────────────────────────
  if (year) {
    const season = data.seasons.find(s => s.year === year) ?? null;
    const log = data.rounds.filter(r => golfSeasonOf(r.date) === year);
    if (!season) {
      return (
        <section className="space-y-4" data-sport-level="season">
          <Link href={basePath} className={backLink}><span aria-hidden="true">←</span> Career</Link>
          <p className="text-secondary">No rounds in {year}.</p>
        </section>
      );
    }
    return <SeasonLevel year={year} season={season} log={log} byRound={byRound} official={official} holesNote={holesNote} kind={isKind(view.stat) ? view.stat : null} href={href} basePath={basePath} />;
  }

  // ── Career ──────────────────────────────────────────────────────────────────
  const { handicap, career } = data;
  const best = (t: GolfTotals, season?: string) => {
    if (!t.best18) return '—';
    const b = t.best18;
    return b.roundId ? <Link href={href({ season: season ?? golfSeasonOf(b.date), game: roundKey(b.roundId) })} className={door} data-golf-best={b.roundId}>{b.gross}</Link> : b.gross;
  };
  return (
    <section className="space-y-6" data-sport-level="career">
      <Tiles tiles={[{ label: handicap.provisional ? 'Handicap estimate (early)' : 'Handicap estimate', value: handicap.index === null ? null : handicap.index.toFixed(1) }, ...tilesOf(career)]} />
      <div>
        <h2 className="mb-3 text-lg font-bold text-primary">Career</h2>
        <Table
          caption="Golf career, by year"
          head={['Season', 'Rounds', 'Average', 'To par', 'Best 18', 'Fairways', 'Greens', 'Putts']}
          rows={data.seasons.map(s => ({ id: s.year, cells: [<Link key="y" href={href({ season: s.year })} className={door} data-season-link={s.year}>{s.year}</Link>, ...totalsCells(s, best(s, s.year))] }))}
          foot={['Career', ...totalsCells(career, best(career))]}
        />
        <p className="mt-2 text-xs text-muted">Average and best read 18-hole rounds. To par and putts are per 18 holes, so 9-hole rounds count too.</p>
      </div>
      {/* Recent form — the handicap and scoring trends the Sports tab's golf layer showed until this page replaced it. */}
      <div data-golf-trends="">
        <h2 className="mb-3 text-lg font-bold text-primary">Trends</h2>
        <GolfBreakdown profileId={profileId} />
      </div>
      {/* Head-to-head in golf (Play, 244) — the athlete chooses what shows. */}
      <RivalsPanel profileId={profileId} sportKey="golf" />
    </section>
  );
}

function SeasonLevel({ year, season, log, byRound, official, holesNote, kind, href, basePath }: {
  year: string;
  season: GolfProfileData['seasons'][number];
  log: GolfRoundListed[];
  byRound: Record<string, GolfHoleRow[]> | null;
  official: string[];
  holesNote: ReactNode;
  kind: ScoreKind | null;
  href: (v: Partial<SportView>) => string;
  basePath: string;
}) {
  // A course is a filter on the round log below it: one tap to see only its rounds, one to see all again.
  const [course, setCourse] = useState<string | null>(null);
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const shown = course ? log.filter(r => same(r.course, course)) : log;
  const kindHoles = kind && byRound ? holesOfKind(log.map(r => ({ id: r.id, date: r.date, course: r.course, holeRows: byRound[r.id] ?? [] })), kind) : null;
  return (
    <section className="space-y-6" data-sport-level="season" data-golf-season={year}>
      <Link href={basePath} className={backLink} data-golf-up="career"><span aria-hidden="true">←</span> Career</Link>
      <h2 className="text-lg font-bold text-primary">{year}</h2>
      <Tiles tiles={[...tilesOf(season), { label: 'Best 18', value: season.best18 ? String(season.best18.gross) : null }]} />

      {season.holesScored > 0 && (
        <div>
          <h3 className="mb-2 text-base font-bold text-primary">Scores</h3>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-5" data-golf-kinds="">
            {SCORE_KINDS.map(k => {
              const n = season.kinds[k.id];
              const body = (
                <>
                  <span className="block text-2xl font-bold tabular-nums text-primary">{n}</span>
                  <span className="block text-xs text-muted">{k.label}</span>
                </>
              );
              return (
                <li key={k.id}>
                  {n > 0 ? (
                    <Link href={href({ season: year, stat: k.id })} aria-current={kind === k.id ? 'true' : undefined} className={`ea-surface ea-interactive block min-h-[44px] rounded-lg p-3 ${kind === k.id ? 'ring-2 ring-brand' : ''}`} data-golf-kind-door={k.id}>{body}</Link>
                  ) : (
                    <div className="ea-surface rounded-lg p-3 opacity-60">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
          {kind && (
            <div className="mt-3 rounded-lg border border-border p-3" data-golf-kind-list={kind}>
              <div className="mb-1 flex items-center justify-between gap-3">
                <h4 className="text-sm font-bold text-primary">{SCORE_KINDS.find(k => k.id === kind)!.label} in {year}</h4>
                <Link href={href({ season: year })} className={backLink}>Close</Link>
              </div>
              {!kindHoles && holesNote}
              {kindHoles && kindHoles.length === 0 && <p className="text-sm text-muted">None in the rounds shown here.</p>}
              {kindHoles && kindHoles.length > 0 && (
                <ul className="divide-y divide-border-subtle">
                  {kindHoles.map(h => (
                    <li key={`${h.roundId}:${h.n}`}>
                      <Link href={href({ season: year, game: roundKey(h.roundId), hole: h.n })} className="ea-interactive flex min-h-[44px] items-center justify-between gap-3 rounded px-1 text-sm" data-golf-kind-hole={`${h.roundId}:${h.n}`}>
                        <span className="min-w-0 truncate text-primary">Hole {h.n} · {h.course}</span>
                        <span className="shrink-0 tabular-nums text-secondary">{h.strokes} on a par {h.par} · {day(h.date)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {season.byPar.length > 0 && (
        <div>
          <h3 className="mb-2 text-base font-bold text-primary">By par</h3>
          <Table caption={`Scoring by par, ${year}`} head={['Holes', 'Played', 'Average to par']} rows={season.byPar.map(p => ({ id: `par-${p.par}`, cells: [`Par ${p.par}s`, p.holes, toParText(Math.round(p.toPar * 10) / 10)] }))} />
        </div>
      )}

      {season.courses.length > 0 && (
        <div>
          <h3 className="mb-2 text-base font-bold text-primary">By course</h3>
          <Table
            caption={`Rounds by course, ${year}`}
            head={['Course', 'Rounds', 'To par', 'Best']}
            rows={season.courses.map(c => ({
              id: `course-${c.course}`,
              cells: [
                <button key="c" type="button" onClick={() => setCourse(cur => (cur && same(cur, c.course) ? null : c.course))} aria-pressed={!!course && same(course, c.course)} className={`${door} text-left`} data-golf-course={c.course}>{c.course}</button>,
                c.rounds,
                toParText(c.toPar18),
                c.best18 ?? (c.best9 !== null ? `${c.best9} (9)` : '—'),
              ],
            }))}
          />
        </div>
      )}

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-bold text-primary">{course ? `Rounds at ${course}` : 'Rounds'}</h3>
          {course && <button type="button" onClick={() => setCourse(null)} className={backLink} data-golf-course-clear="">All courses</button>}
        </div>
        {shown.length === 0 ? (
          <p className="text-sm text-muted">No rounds to show here.</p>
        ) : (
          <ul className="space-y-2" data-golf-rounds="">
            {shown.map(r => (
              <li key={r.id}>
                <Link href={href({ season: year, game: roundKey(r.id) })} className="ea-surface ea-interactive flex min-h-[56px] items-center justify-between gap-3 rounded-lg p-3" data-golf-round-link={r.id}>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-primary">{r.course}</span>
                    <span className="block text-sm text-secondary">{day(r.date)} · {r.holes} holes{official.includes(r.id) ? ' · Official' : ''}{r.hidden ? ' · Hidden' : ''}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-lg font-bold tabular-nums text-primary">{r.gross ?? '—'}</span>
                    {r.toPar !== null && <span className="block text-xs tabular-nums text-muted">{toParText(r.toPar)}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
