'use client';

import { useEffect, useState } from 'react';
import type { ProviderUsage } from '@/lib/golf/provider-usage-server';

// Golf data providers (Nov 20 2026): calls today against each daily limit, and
// what is being skipped after a failure. Read-only.

const LABEL: Record<string, string> = {
  golfcourseapi: 'GolfCourseAPI (scorecards on a pick)',
  opengolfapi: 'OpenGolfAPI (all calls)',
  'card-fill': 'OpenGolfAPI background fill',
  'site-card': 'Course website reader',
  'golfcourseapi-proximity': 'GolfCourseAPI near me',
  nominatim: 'Nominatim (course location)',
  overpass: 'Overpass (a map opened)',
  'open-meteo': 'Open-Meteo (elevation)',
  'terrain-tiles': 'Terrain tiles (a map opened)',
  'sweep-overpass': 'Overpass (background map sweep)',
  'sweep-terrain': 'Terrain tiles (background sweep)',
};

const time = (iso: string) => new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function GolfProvidersPanel() {
  const [answer, setAnswer] = useState<ProviderUsage | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/golf-providers', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('failed'))))
      .then((b: ProviderUsage) => { if (!cancelled) setAnswer(b); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, []);
  return (
    <section className="rounded-lg border border-border bg-surface p-4" data-admin-golf-providers="">
      <h2 className="text-lg font-semibold text-primary">Golf data providers</h2>
      <p className="mt-1 text-sm text-secondary">Calls in each provider&apos;s current 24-hour window, against its daily limit.</p>
      {error && <p className="mt-2 text-sm text-tertiary">Could not load provider usage.</p>}
      {answer && (
        <>
          <ul className="mt-3 divide-y divide-border-subtle text-sm">
            {answer.providers.map(p => (
              <li key={p.source} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5" data-provider-row={p.source} data-provider-state={p.state}>
                <span className="min-w-0 break-words text-primary">{LABEL[p.source] ?? p.source}</span>
                <span className="text-secondary">
                  <span className="font-semibold text-primary" data-provider-used="">{p.used.toLocaleString()} of {p.limit.toLocaleString()}</span>
                  {p.state === 'reached' && <span data-provider-reached=""> · limit reached{p.refused > 0 ? `, ${p.refused.toLocaleString()} refused` : ''}</span>}
                  {p.resetsAt ? ` · resets ${time(p.resetsAt)}` : ' · nothing used yet'}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3 text-sm" data-provider-skipped="">
            {answer.skipped.length > 0 ? (
              <ul>
                {answer.skipped.map(s => (
                  <li key={s.host} className="break-words text-primary" data-provider-skipped-host={s.host}>
                    {s.host} is being skipped after a failure, until {time(s.until)}.
                  </li>
                ))}
              </ul>
            ) : <p className="text-secondary">No provider is being skipped by this server instance.</p>}
            <p className="mt-1 text-tertiary">Skipping is remembered per server instance, so this line shows only the instance that answered.</p>
          </div>
        </>
      )}
    </section>
  );
}
