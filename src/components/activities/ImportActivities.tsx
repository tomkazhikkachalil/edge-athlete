'use client';

// /activities/import — bring in what a watch or an app recorded.
// .GPX / .TCX are parsed HERE (a long ride's XML can exceed the request cap)
// and sent as the compact payload; a .FIT is sent as-is and decoded on the
// server (Garmin's SDK is licensed to stay off clients). The parsers load
// only when a file is picked. A `.gz` export (Strava's bulk export) is
// unzipped where the browser can (DecompressionStream is newer than the iOS
// 15 floor — feature-detected, else the athlete is told to unzip it).
// Files go one at a time, each with its own result; a "too fast for a run"
// refusal offers the type picker and a retry.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useDirtyClose } from '@/hooks/useDirtyClose';
import { FEATURE_FLAGS } from '@/lib/features';
import { ACTIVITY_TYPE_DEFS, ACTIVITY_TYPES, type ActivityType } from '@/lib/activities/catalog';

const MAX_FILES = 10;
const MAX_XML_BYTES = 60 * 1024 * 1024;
const MAX_FIT_BYTES = 4 * 1024 * 1024;

type Status = 'queued' | 'working' | 'imported' | 'updated' | 'failed';
interface Row {
  key: string;
  file: File;
  status: Status;
  message: string | null;
  id: string | null;
  /** The athlete's pick after a refusal; null = the file's own sport. */
  type: ActivityType | null;
  offerType: boolean;
}

function kindOf(name: string): { kind: 'fit' | 'gpx' | 'tcx' | null; gz: boolean } {
  const n = name.toLowerCase();
  const gz = n.endsWith('.gz');
  const base = gz ? n.slice(0, -3) : n;
  const kind = base.endsWith('.fit') ? 'fit' : base.endsWith('.gpx') ? 'gpx' : base.endsWith('.tcx') ? 'tcx' : null;
  return { kind, gz };
}

async function gunzip(file: File): Promise<Blob | null> {
  const DS = (globalThis as { DecompressionStream?: new (format: string) => TransformStream<Uint8Array, Uint8Array> }).DecompressionStream;
  if (typeof DS !== 'function') return null;
  const stream = file.stream().pipeThrough(new DS('gzip'));
  return new Response(stream).blob();
}

const localZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
};

export default function ImportActivities() {
  const { user, initialAuthCheckComplete, activeProfile } = useAuth();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const targetProfileId = activeProfile?.id ?? null;
  const profileId = targetProfileId ?? user?.id ?? null;

  useEffect(() => {
    if (initialAuthCheckComplete && !user) router.replace('/');
  }, [initialAuthCheckComplete, user, router]);

  // Leaving mid-import asks first (the browser's own prompt).
  useDirtyClose(() => running, () => undefined);

  const update = (key: string, patch: Partial<Row>) => setRows(rs => rs.map(r => (r.key === key ? { ...r, ...patch } : r)));

  const importOne = async (row: Row): Promise<void> => {
    update(row.key, { status: 'working', message: null, offerType: false });
    const { kind, gz } = kindOf(row.file.name);
    if (!kind) {
      update(row.key, { status: 'failed', message: 'Pick a .fit, .gpx or .tcx file.' });
      return;
    }
    let blob: Blob = row.file;
    if (gz) {
      const out = await gunzip(row.file).catch(() => null);
      if (!out) {
        update(row.key, { status: 'failed', message: 'Unzip this file first (it ends in .gz), then import the file inside.' });
        return;
      }
      blob = out;
    }
    try {
      let res: Response;
      if (kind === 'fit') {
        if (blob.size > MAX_FIT_BYTES) {
          update(row.key, { status: 'failed', message: 'This FIT file is larger than 4 MB — that is not an activity file.' });
          return;
        }
        const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
        if (String.fromCharCode(head[8], head[9], head[10], head[11]) !== '.FIT') {
          update(row.key, { status: 'failed', message: 'This is not a FIT file.' });
          return;
        }
        const form = new FormData();
        form.append('file', blob, row.file.name.replace(/\.gz$/i, ''));
        const tz = localZone();
        if (tz) form.append('tz', tz);
        if (row.type) form.append('type', row.type);
        if (targetProfileId) form.append('targetProfileId', targetProfileId);
        res = await fetch('/api/activities/fit', { method: 'POST', credentials: 'include', body: form });
      } else {
        if (blob.size > MAX_XML_BYTES) {
          update(row.key, { status: 'failed', message: 'This file is too large to import.' });
          return;
        }
        const text = await blob.text();
        const [{ parseGpx }, { parseTcx }, { toWire }, { ActivityParseError }] = await Promise.all([
          import('@/lib/activities/parse-gpx'),
          import('@/lib/activities/parse-tcx'),
          import('@/lib/activities/wire'),
          import('@/lib/activities/xml-scan'),
        ]);
        let parsed;
        try {
          parsed = kind === 'gpx' ? parseGpx(text) : parseTcx(text);
        } catch (e) {
          update(row.key, { status: 'failed', message: e instanceof ActivityParseError ? e.message : 'This file could not be read.' });
          return;
        }
        const activity = toWire({ ...parsed, format: kind, ...(row.type ? { type: row.type } : {}) }, localZone());
        res = await fetch('/api/activities', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ activity, ...(targetProfileId ? { targetProfileId } : {}) }),
        });
      }
      const json = (await res.json().catch(() => ({}))) as { id?: string; duplicate?: boolean; error?: string };
      if (res.ok && json.id) {
        update(row.key, { status: json.duplicate ? 'updated' : 'imported', id: json.id, message: null });
        return;
      }
      const message = typeof json.error === 'string' ? json.error : res.status === 429 ? 'Too many imports at once — wait a little and try again.' : 'This file could not be imported.';
      update(row.key, { status: 'failed', message, offerType: res.status === 422 && /faster than/.test(message) });
    } catch {
      update(row.key, { status: 'failed', message: 'Check your connection and try again.' });
    }
  };

  const runAll = async (list: Row[]) => {
    setRunning(true);
    try {
      for (const r of list) await importOne(r);
    } finally {
      setRunning(false);
    }
  };

  const onPick = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const picked = Array.from(files).slice(0, MAX_FILES).map((file, i) => ({
      key: `${Date.now()}-${i}-${file.name}`,
      file,
      status: 'queued' as Status,
      message: null,
      id: null,
      type: null,
      offerType: false,
    }));
    setRows(rs => [...picked, ...rs]);
    if (inputRef.current) inputRef.current.value = '';
    void runAll(picked);
  };

  if (!initialAuthCheckComplete || !user) {
    return (
      <div className="flex justify-center py-16" aria-busy="true">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand" />
      </div>
    );
  }

  const doneAny = rows.some(r => r.status === 'imported' || r.status === 'updated');
  return (
    <div className="space-y-6" data-activity-import>
      <div>
        <h1 className="text-2xl font-bold text-primary">Import activities</h1>
        <p className="text-secondary mt-1">
          Add runs, rides, hikes and more from your watch or app{activeProfile ? ` for ${activeProfile.first_name ?? activeProfile.full_name ?? 'your athlete'}` : ''}.
        </p>
        {/* The standing alternative to a file (mig 247) — the account's own,
            so never offered while acting for an athlete. */}
        {FEATURE_FLAGS.FEATURE_CONNECTED_APPS && !activeProfile && (
          <p className="text-sm text-tertiary mt-1" data-import-connect-hint>
            Tired of files?{' '}
            <Link href="/settings?tab=connections" className="font-medium text-brand-fg underline">
              Connect your watch
            </Link>{' '}
            once and workouts arrive by themselves.
          </p>
        )}
      </div>

      <label className="ea-surface flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-8 text-center cursor-pointer ea-interactive">
        <i className="fas fa-file-arrow-up text-3xl text-brand-fg" aria-hidden="true" />
        <span className="text-base font-semibold text-primary">Choose files</span>
        <span className="text-sm text-secondary">.fit, .gpx or .tcx — up to {MAX_FILES} at a time</span>
        {/* No `accept` filter on purpose: iOS greys out .fit / .gpx in the
            Files picker when it does not know the type. Checked below. */}
        <input ref={inputRef} type="file" multiple className="sr-only" onChange={e => onPick(e.target.files)} disabled={running} data-activity-file-input />
      </label>

      {rows.length > 0 && (
        <ul className="space-y-3" aria-live="polite">
          {rows.map(r => (
            <li key={r.key} className="ea-surface rounded-lg p-3" data-import-row={r.status}>
              <div className="flex items-center gap-3">
                <span className="w-6 text-center" aria-hidden="true">
                  {r.status === 'working' || r.status === 'queued' ? (
                    <i className="fas fa-spinner fa-spin text-muted" />
                  ) : r.status === 'failed' ? (
                    <i className="fas fa-circle-exclamation text-danger-fg" />
                  ) : (
                    <i className="fas fa-circle-check text-success-fg" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-primary">{r.file.name}</p>
                  <p className="text-sm text-secondary">
                    {r.status === 'queued' && 'Waiting…'}
                    {r.status === 'working' && 'Importing…'}
                    {r.status === 'imported' && 'Imported'}
                    {r.status === 'updated' && 'Already here — updated'}
                    {r.status === 'failed' && r.message}
                  </p>
                </div>
                {r.id && (
                  <Link href={`/activities/${r.id}`} className="shrink-0 rounded-lg px-3 py-2 text-sm font-semibold text-brand-fg ea-interactive min-h-[44px] inline-flex items-center">
                    View
                  </Link>
                )}
              </div>
              {r.offerType && (
                <div className="mt-3 flex flex-wrap items-center gap-2 pl-9">
                  <label className="text-sm text-secondary" htmlFor={`type-${r.key}`}>
                    It was a
                  </label>
                  <select
                    id={`type-${r.key}`}
                    value={r.type ?? ''}
                    onChange={e => update(r.key, { type: (e.target.value || null) as ActivityType | null })}
                    className="rounded-lg border border-border bg-surface px-3 py-2 text-base text-primary"
                  >
                    <option value="">Choose…</option>
                    {ACTIVITY_TYPES.map(t => (
                      <option key={t} value={t}>
                        {ACTIVITY_TYPE_DEFS[t].label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!r.type || running}
                    onClick={() => void runAll([r])}
                    className="ea-cta rounded-lg px-4 py-2 font-semibold min-h-[44px] disabled:opacity-50"
                  >
                    Try again
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {doneAny && profileId && (
        <Link href={`/athlete/${profileId}?tab=activities`} className="ea-cta inline-flex items-center justify-center rounded-lg px-4 py-2 font-semibold min-h-[44px]">
          See all activities
        </Link>
      )}

      <section className="text-sm text-secondary space-y-2">
        <h2 className="text-base font-semibold text-primary">Where to find your files</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Garmin:</strong> on connect.garmin.com open the activity, then the gear menu → Export Original (.fit).</li>
          <li><strong>Strava:</strong> open the activity on strava.com, then ••• → Export Original or Export GPX.</li>
          <li><strong>Apple Watch:</strong> export the workout as .gpx or .fit with an app such as HealthFit, then choose it here.</li>
          <li><strong>Coros, Suunto, Polar, Wahoo:</strong> each app can export an activity as .fit or .gpx.</li>
        </ul>
        <p>The first and last 200 m of every route stay private to you. Only you choose what goes on your feed.</p>
      </section>
    </div>
  );
}
