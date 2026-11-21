'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ParReview, ParReviewCourse, ParReviewHole } from '@/lib/golf/par-evidence-server';

// Scorecard pars under review (Nov 20 2026; migration 317). A provider's tee
// boxes sometimes disagree on a hole's par. The app decides those holes by
// rule and by confirmations from other sources (par-evidence.ts); nobody is
// asked. What is listed here is only what logic cannot decide: a hole no tee
// gives a believable par for, and a confirmed correction not yet written.
// One tap keeps or sets the par, recorded with who made it. No SQL.

const btn = 'px-3 py-1.5 text-sm min-h-[36px] rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors disabled:opacity-50';
const SOURCE: Record<string, string> = { map: 'the map', website: 'the course website', opengolfapi: 'OpenGolfAPI', length: 'the hole\'s length' };
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** One line per tee: its yardage on the saved card and the par that tee's box
 *  gives, longest tee first; then what the other sources say. A tee the card
 *  has no yardage for still shows its par. */
function teeLines(h: ParReviewHole): Array<{ tee: string; yards: number | null; par: number | null }> {
  const tees = [...new Set([...Object.keys(h.boxes), ...Object.keys(h.yards)])];
  return tees
    .map(tee => ({ tee, yards: h.yards[tee] ?? null, par: h.boxes[tee] ?? null }))
    .sort((a, b) => (b.yards ?? -1) - (a.yards ?? -1) || a.tee.localeCompare(b.tee));
}
const otherSources = (h: ParReviewHole): string => Object.entries(h.independent).map(([s, par]) => `${SOURCE[s] ?? s} says par ${par}`).join(' · ');

export default function GolfParReviewPanel() {
  const [review, setReview] = useState<(ParReview & { writesEnabled: boolean }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // What the last tap on each course did, shown AT that course (Nov 20 2026:
  // the line used to sit at the top of the panel, out of sight of the hole
  // that was tapped, and the list took seconds to refresh, so a tap that had
  // worked looked like nothing had happened).
  const [notes, setNotes] = useState<Record<string, { name: string; text: string; failed: boolean }>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/golf-par-review', { credentials: 'include', cache: 'no-store' });
      if (!res.ok) throw new Error('failed');
      setReview(await res.json());
      setError(null);
    } catch {
      setError('Could not load the scorecards under review.');
    }
  }, []);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/golf-par-review', { credentials: 'include', cache: 'no-store' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('failed'))))
      .then(b => { if (!cancelled) setReview(b); })
      .catch(() => { if (!cancelled) setError('Could not load the scorecards under review.'); });
    return () => { cancelled = true; };
  }, []);

  const decide = async (course: ParReviewCourse, hole: ParReviewHole, par: number) => {
    const key = `${course.courseId}:${hole.hole}`;
    const note = (text: string, failed: boolean) => setNotes(prev => ({ ...prev, [course.courseId]: { name: course.name, text, failed } }));
    setBusy(key);
    try {
      const res = await fetch('/api/admin/golf-par-review', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId: course.courseId, hole: hole.hole, par }),
      });
      const body = (await res.json().catch(() => null)) as { changed?: boolean; error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? 'The par could not be saved');
      note(body?.changed ? `Hole ${hole.hole}: par ${hole.saved} changed to ${par}. Recorded.` : `Hole ${hole.hole}: par ${par} kept. Recorded as decided.`, false);
      // The hole leaves the list at once; the server's own list follows behind.
      setReview(prev => prev && { ...prev, courses: prev.courses.map(c => (c.courseId === course.courseId ? { ...c, holes: c.holes.filter(h => h.hole !== hole.hole) } : c)).filter(c => c.holes.length > 0) });
      void load();
    } catch (e) {
      note(`Hole ${hole.hole} failed: ${e instanceof Error ? e.message : 'the par could not be saved'}`, true);
    } finally {
      setBusy(null);
    }
  };

  // A course whose last hole was just decided stays on screen with its note.
  const shown: ParReviewCourse[] = review
    ? [...review.courses, ...Object.entries(notes).filter(([id]) => !review.courses.some(c => c.courseId === id)).map(([id, n]) => ({ courseId: id, name: n.name, city: null, region: null, picks: -1, holes: [] }))]
    : [];

  return (
    <section aria-label="Scorecard pars under review" className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6" data-admin-golf-par-review="">
      <h2 className="text-lg font-semibold text-primary mb-1">Scorecard pars under review</h2>
      <p className="text-xs text-muted mb-3">
        A provider&apos;s tee boxes sometimes disagree on a hole&apos;s par. The app decides those holes itself: by the tees and their lengths, confirmed where the club&apos;s website, the other provider or the map agree. Only a hole it cannot decide is listed here. Choosing a par corrects the saved scorecard at once and records who decided; rounds already played keep their own pars.
      </p>
      {error && <p className="text-sm text-red-600 dark:text-red-400 mb-3" data-par-review-error="">{error}</p>}
      {!review && !error && <p className="text-xs text-muted mb-3">Loading…</p>}
      {review && (
        <>
          <p className="text-sm text-secondary mb-1" data-par-review-summary="">
            {review.courses.length === 0
              ? `Nothing is waiting. ${review.judged} scorecards hold their tee boxes.`
              : `${plural(review.courses.reduce((n, c) => n + c.holes.length, 0), 'hole', 'holes')} on ${plural(review.courses.length, 'course', 'courses')} waiting, of ${review.judged} scorecards that hold their tee boxes.`}
          </p>
          <p className="text-xs text-muted mb-3" data-par-review-counts="">
            Holes whose tees disagree: {review.counts.confirmed} confirmed by another source or decided here · {review.counts.byRule} decided by the rule · {review.counts.impossible} impossible.
          </p>
          <ul className="space-y-4">
            {shown.map(course => (
              <li key={course.courseId} className="border-t border-border-subtle pt-3" data-par-review-course={course.courseId}>
                <p className="text-sm font-semibold text-primary break-words">{course.name}</p>
                {course.picks >= 0 && <p className="text-xs text-muted mb-2">{[course.city, course.region].filter(Boolean).join(', ') || 'Location unknown'} · picked {course.picks} {course.picks === 1 ? 'time' : 'times'}</p>}
                {notes[course.courseId] && (
                  <p className={`text-sm mb-2 ${notes[course.courseId].failed ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-300'}`} role="status" data-par-review-outcome="">
                    {notes[course.courseId].text}{course.holes.length === 0 && !notes[course.courseId].failed ? ' Nothing else is waiting on this course.' : ''}
                  </p>
                )}
                <ul className="space-y-3">
                  {course.holes.map(hole => (
                    <li key={hole.hole} data-par-review-hole={hole.hole}>
                      <p className="text-sm text-primary">Hole {hole.hole} <span className="text-secondary">· saved as par {hole.saved}</span></p>
                      <p className="text-xs text-muted mb-1" data-par-review-why={hole.why}>
                        {hole.why === 'impossible' ? 'No tee gives a par its length allows.' : `Confirmed as par ${hole.settled ?? '?'}; the correction is not written yet.`}
                      </p>
                      <ul className="text-xs text-secondary mb-1.5 grid grid-cols-1 sm:grid-cols-2 gap-x-4" data-par-review-says="">
                        {teeLines(hole).map(t => (
                          <li key={t.tee} className="break-words" data-par-review-tee={t.tee}>
                            <span className="capitalize">{t.tee}</span> · {t.yards !== null ? `${t.yards} yds` : 'no yardage'} · {t.par !== null ? <span className={t.par === hole.saved ? '' : 'font-semibold text-primary'}>par {t.par}</span> : 'no par given'}
                          </li>
                        ))}
                      </ul>
                      {otherSources(hole) && <p className="text-xs text-muted mb-1.5 break-words" data-par-review-other="">{otherSources(hole)}</p>}
                      <div className="flex flex-wrap gap-2">
                        {hole.candidates.map(par => (
                          <button key={par} type="button" disabled={!!busy && busy.startsWith(`${course.courseId}:`)} onClick={() => decide(course, hole, par)} className={btn} data-par-review-set={par}>
                            {busy === `${course.courseId}:${hole.hole}` ? 'Saving…' : par === hole.saved ? `Keep par ${par}` : `Change to par ${par}`}
                          </button>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          <div className="mt-4 border-t border-border-subtle pt-3" data-par-review-changes="">
            <h3 className="text-sm font-semibold text-primary mb-1">Recent par changes</h3>
            {review.changes.length === 0 ? (
              <p className="text-xs text-muted">No par has been changed yet.</p>
            ) : (
              <ul className="text-xs text-secondary space-y-1">
                {review.changes.map(c => (
                  <li key={c.id} className="break-words" data-par-review-change="">
                    {c.courseName}, hole {c.hole}: par {c.fromPar} to {c.toPar} · {c.reason === 'admin' ? `decided by ${c.actor}` : `settled by ${c.settledBy ?? 'evidence'}`} · {when(c.changedAt)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
