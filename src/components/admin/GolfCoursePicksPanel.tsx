'use client';

import { useEffect, useState } from 'react';

// Which picked courses have a card (294): what any data spend should target.

interface Row { card: string; picks: number; golf_courses: { name: string; city: string | null; region: string | null } | null }
interface Answer { totals: Record<string, { courses: number; picks: number }>; top: Row[] }

const LABEL: Record<string, string> = { provider: 'Official card', map: 'Map card', none: 'No card' };

export default function GolfCoursePicksPanel() {
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/golf-course-picks', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('failed'))))
      .then((b: Answer) => { if (!cancelled) setAnswer(b); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, []);
  return (
    <section className="rounded-lg border border-border bg-surface p-4" data-course-picks="">
      <h2 className="text-lg font-semibold text-primary">Course picks and scorecards</h2>
      {error && <p className="mt-2 text-sm text-tertiary">Could not load course picks.</p>}
      {answer && (
        <>
          <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
            {Object.keys(LABEL).map(k => (
              <div key={k}>
                <dt className="text-secondary">{LABEL[k]}</dt>
                <dd className="font-semibold text-primary">{answer.totals[k]?.courses ?? 0} courses · {answer.totals[k]?.picks ?? 0} picks</dd>
              </div>
            ))}
          </dl>
          {answer.top.length > 0 ? (
            <ul className="mt-3 divide-y divide-border-subtle text-sm">
              {answer.top.map((r, i) => (
                <li key={i} className="flex items-baseline justify-between gap-3 py-1.5">
                  <span className="min-w-0 truncate text-primary">{r.golf_courses?.name ?? 'Unknown'}</span>
                  <span className="whitespace-nowrap text-secondary">{LABEL[r.card]} · {r.picks}</span>
                </li>
              ))}
            </ul>
          ) : <p className="mt-3 text-sm text-tertiary">No picks without an official card yet.</p>}
        </>
      )}
    </section>
  );
}
