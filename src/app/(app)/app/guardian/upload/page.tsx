'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import AppHeader from '@/components/AppHeader';
import CaptureInputs from '@/components/media/CaptureInputs';
import BatchUploadItemCard, {
  type BatchAthleteOption,
  type ItemEventSuggestion,
} from '@/components/guardian/BatchUploadItemCard';
import { MediaEditor } from '@/components/media-editor';
import { validateFiles } from '@/lib/media/validation';
import { inferEvent, eventWindowsFromApi, type EventWindow } from '@/lib/calendar/event-autotag';
import { useBatchUpload, type BatchRunGroup, type BatchRunItem } from '@/hooks/useBatchUpload';
import { FEATURE_FLAGS } from '@/lib/features';
import { formatDisplayName } from '@/lib/formatters';
import type { EditedMedia, EditorConfig, MediaAsset } from '@/lib/media/types';

// ── Guardian batch upload (Wave 5) ───────────────────────────────────────────
// One camera roll → posts across the household. Every picked file goes
// through the shared MediaEditor (no skip path — the composer's rule), gets
// per-item athlete assignment, and an event suggestion the guardian must
// CONFIRM (event-autotag.ts refuses to guess when it can't be trusted).
// One post per (athlete × confirmed-event-or-null); items shared across
// athletes are server-copied to each athlete's own storage prefix.

const MAX_ITEMS = 12;
const MAX_BYTES = 50 * 1024 * 1024;
// Predicted-budget guards — the server's rate buckets are upload 60/h and
// post-create 30/h; staying under them with headroom means a full batch
// never dies to a 429 halfway.
const MAX_UPLOAD_TOKENS = 45;
const MAX_POSTS = 20;
// Events are matched around each item's capture day (±3d fetch window).
const RANGE_PAD_MS = 3 * 86_400_000;
const MAX_RANGE_MS = 60 * 86_400_000; // events API range cap headroom

const EDITOR_CONFIG: EditorConfig = {
  aspectRatios: ['free', '1:1', '4:5', '9:16', '16:9'],
  allowVideo: true,
  maxAssets: MAX_ITEMS,
  output: { maxDimension: 1600, mime: 'image/jpeg', quality: 0.85 },
};

interface RosterAthlete {
  id: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  supervision_state: string | null;
  consentState: string;
  deletion_requested_at: string | null;
}

interface PageItem {
  id: string;
  file: File;
  previewUrl: string;
  kind: 'image' | 'video';
  posterBlob?: Blob;
  durationSeconds?: number;
  /** From the ORIGINAL file's lastModified — the rendered blob's timestamp
   *  is "now" and would match nothing (RoundMediaManager precedent). */
  capturedAtMs: number;
  athleteIds: string[];
  /** Per-athlete answer to the suggestion chip, pinned to the suggested
   *  event id so a changed suggestion re-asks instead of silently
   *  attaching something else. */
  decisions: Record<string, { eventId: string; decision: 'attached' | 'declined' }>;
}

export default function GuardianBatchUploadPage() {
  const router = useRouter();
  const { user, loading, initialAuthCheckComplete } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);

  const [roster, setRoster] = useState<RosterAthlete[]>([]);
  const [rosterState, setRosterState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [items, setItems] = useState<PageItem[]>([]);
  const [editorAssets, setEditorAssets] = useState<MediaAsset[] | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [eventsByAthlete, setEventsByAthlete] = useState<Record<string, EventWindow[]>>({});
  // Which (athlete, range) fetches have run — a ref so the fetch effect never
  // depends on the state it writes.
  const fetchedRangesRef = useRef(new Map<string, string>());
  const { run, running, progress, outcome } = useBatchUpload();

  useEffect(() => {
    if (!loading && initialAuthCheckComplete && !user) router.replace('/');
  }, [loading, initialAuthCheckComplete, user, router]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/guardian/athletes');
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Could not load your athletes');
        if (cancelled) return;
        setRoster(data.athletes ?? []);
        setRosterState('ready');
      } catch (e) {
        console.error('[BATCH UPLOAD] roster load failed:', e);
        if (!cancelled) setRosterState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Revoke preview objectURLs on unmount (the editor hands ownership to us).
  const previewUrlsRef = useRef<string[]>([]);
  useEffect(() => {
    return () => {
      previewUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
    };
  }, []);

  const athleteOptions: BatchAthleteOption[] = useMemo(
    () =>
      roster
        .filter(a => !a.deletion_requested_at && a.supervision_state === 'supervised')
        .map(a => ({
          id: a.id,
          name: formatDisplayName(a.first_name, null, a.last_name, a.display_name),
          selectable: a.consentState === 'approved',
          blockedReason:
            a.consentState === 'approved'
              ? undefined
              : 'Needs approved consent before you can post for them.',
        })),
    [roster]
  );
  const anyBlocked = athleteOptions.some(a => !a.selectable);
  const defaultAssign = useMemo(() => {
    const selectable = athleteOptions.filter(a => a.selectable);
    return selectable.length === 1 ? [selectable[0].id] : [];
  }, [athleteOptions]);

  // Capture-time range across the batch, padded — drives the per-athlete
  // events fetch. Clamped to the events API's range cap.
  const range = useMemo(() => {
    if (items.length === 0) return null;
    const times = items.map(i => i.capturedAtMs).filter(t => Number.isFinite(t));
    if (times.length === 0) return null;
    let fromMs = Math.min(...times) - RANGE_PAD_MS;
    const toMs = Math.max(...times) + RANGE_PAD_MS;
    if (toMs - fromMs > MAX_RANGE_MS) fromMs = toMs - MAX_RANGE_MS;
    return { fromMs, toMs, key: `${fromMs}-${toMs}` };
  }, [items]);

  const assignedIdsKey = useMemo(
    () => [...new Set(items.flatMap(i => i.athleteIds))].sort().join(','),
    [items]
  );

  useEffect(() => {
    if (!FEATURE_FLAGS.FEATURE_CALENDAR || !range || !assignedIdsKey) return;
    const athleteIds = assignedIdsKey.split(',').filter(Boolean);
    const rangeKey = range.key;
    for (const athleteId of athleteIds) {
      if (fetchedRangesRef.current.get(athleteId) === rangeKey) continue;
      fetchedRangesRef.current.set(athleteId, rangeKey);
      (async () => {
        try {
          const from = new Date(range.fromMs).toISOString();
          const to = new Date(range.toMs).toISOString();
          const res = await fetch(
            `/api/calendar/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(
              to
            )}&targetProfileId=${athleteId}`
          );
          if (!res.ok) throw new Error(`status ${res.status}`);
          const data = await res.json();
          // Superseded by a newer range while in flight → drop. NO
          // effect-scoped cancelled flag: assigning a second athlete
          // re-runs this effect, and a cleanup flag DISCARDED the first
          // athlete's still-in-flight events (the ref already marked them
          // fetched, so their chips never appeared — caught by e2e, but
          // two quick pill taps reproduce it by hand). The fetch is
          // idempotent per (athlete, range); landing late is harmless.
          if (fetchedRangesRef.current.get(athleteId) !== rangeKey) return;
          // Real commitments only — overlay rows (no my_status key) and
          // cancelled events never suggest (the week strip's filter).
          const events = ((data.events ?? []) as Array<{
            id: string;
            title: string;
            starts_at: string;
            ends_at: string;
            all_day?: boolean;
            status?: string;
            my_status?: string | null;
          }>).filter(ev => ev.my_status !== undefined && ev.status !== 'cancelled');
          setEventsByAthlete(prev => ({ ...prev, [athleteId]: eventWindowsFromApi(events) }));
        } catch (e) {
          // Suggestions are an offer, never a blocker — a failed fetch just
          // means no chips for this athlete. Allow a retry on range change.
          console.warn('[BATCH UPLOAD] events fetch failed:', e);
          if (fetchedRangesRef.current.get(athleteId) === rangeKey) {
            fetchedRangesRef.current.delete(athleteId);
          }
        }
      })();
    }
  }, [range, assignedIdsKey]);

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList?.length) return;
    setPickError(null);
    const { accepted, rejected } = validateFiles(Array.from(fileList), {
      maxBytes: MAX_BYTES,
      allowVideo: true,
      maxCount: MAX_ITEMS,
      existingCount: items.length,
    });
    if (rejected.length) setPickError(rejected[0].message);
    if (accepted.length > 0) {
      setEditorAssets(
        accepted.map(file => ({
          id: `${Date.now()}-${Math.random()}`,
          file,
          kind: file.type.startsWith('video/') ? ('video' as const) : ('image' as const),
        }))
      );
    }
    if (inputRef.current) inputRef.current.value = '';
  };

  const handleEditorDone = (results: EditedMedia[]) => {
    setEditorAssets(null);
    const fresh: PageItem[] = results.map(r => ({
      id: r.id,
      file: r.file,
      previewUrl: r.previewUrl,
      kind: r.kind === 'video' ? 'video' : 'image',
      posterBlob: r.posterBlob,
      durationSeconds: r.durationSeconds,
      capturedAtMs: r.sourceFile.lastModified,
      athleteIds: [...defaultAssign],
      decisions: {},
    }));
    previewUrlsRef.current.push(...fresh.map(f => f.previewUrl));
    setItems(prev => [...prev, ...fresh].slice(0, MAX_ITEMS));
  };

  const toggleAthlete = (itemId: string, athleteId: string) => {
    setItems(prev =>
      prev.map(item =>
        item.id === itemId
          ? {
              ...item,
              athleteIds: item.athleteIds.includes(athleteId)
                ? item.athleteIds.filter(id => id !== athleteId)
                : [...item.athleteIds, athleteId],
            }
          : item
      )
    );
  };

  const removeItem = (itemId: string) => {
    setItems(prev => {
      const item = prev.find(i => i.id === itemId);
      if (item) {
        URL.revokeObjectURL(item.previewUrl);
        previewUrlsRef.current = previewUrlsRef.current.filter(u => u !== item.previewUrl);
      }
      return prev.filter(i => i.id !== itemId);
    });
  };

  // The per-(item × athlete) suggestion table, recomputed from current
  // assignments + fetched events. A decision is honored only while it still
  // points at the SAME suggested event.
  const suggestionsByItem = useMemo(() => {
    const nameById = new Map(athleteOptions.map(a => [a.id, a.name]));
    const table = new Map<string, ItemEventSuggestion[]>();
    for (const item of items) {
      const rows: ItemEventSuggestion[] = [];
      for (const athleteId of item.athleteIds) {
        const windows = eventsByAthlete[athleteId];
        if (!windows) continue;
        const inferred = inferEvent(item.capturedAtMs, windows);
        if (!inferred.eventId || !inferred.title) continue;
        const prior = item.decisions[athleteId];
        rows.push({
          athleteId,
          athleteName: nameById.get(athleteId) ?? '',
          eventId: inferred.eventId,
          title: inferred.title,
          decision: prior && prior.eventId === inferred.eventId ? prior.decision : 'pending',
        });
      }
      table.set(item.id, rows);
    }
    return table;
  }, [items, eventsByAthlete, athleteOptions]);

  const decideSuggestion = (itemId: string, athleteId: string, decision: 'attached' | 'declined') => {
    const suggestion = suggestionsByItem.get(itemId)?.find(s => s.athleteId === athleteId);
    if (!suggestion) return;
    setItems(prev =>
      prev.map(item =>
        item.id === itemId
          ? {
              ...item,
              decisions: {
                ...item.decisions,
                [athleteId]: { eventId: suggestion.eventId, decision },
              },
            }
          : item
      )
    );
  };

  // One post per (athlete × confirmed-event-or-null). Deterministic order:
  // roster order, then event-less last.
  const groups: BatchRunGroup[] = useMemo(() => {
    const byKey = new Map<string, BatchRunGroup>();
    const athleteOrder = new Map(athleteOptions.map((a, i) => [a.id, i]));
    for (const item of items) {
      const suggestions = suggestionsByItem.get(item.id) ?? [];
      for (const athleteId of item.athleteIds) {
        const s = suggestions.find(row => row.athleteId === athleteId);
        const eventId = s && s.decision === 'attached' ? s.eventId : null;
        const key = `${athleteId}|${eventId ?? ''}`;
        const existing = byKey.get(key);
        if (existing) existing.itemIds.push(item.id);
        else byKey.set(key, { athleteId, eventId, itemIds: [item.id] });
      }
    }
    return [...byKey.values()].sort(
      (a, b) =>
        (athleteOrder.get(a.athleteId) ?? 99) - (athleteOrder.get(b.athleteId) ?? 99) ||
        (a.eventId ? 0 : 1) - (b.eventId ? 0 : 1)
    );
  }, [items, suggestionsByItem, athleteOptions]);

  const athleteCount = new Set(groups.map(g => g.athleteId)).size;
  const uploadTokens = items.reduce(
    (sum, item) => sum + item.athleteIds.length * (item.posterBlob ? 2 : 1),
    0
  );
  const overBudget = uploadTokens > MAX_UPLOAD_TOKENS || groups.length > MAX_POSTS;
  const unassignedCount = items.filter(i => i.athleteIds.length === 0).length;
  const startDisabled =
    running || groups.length === 0 || overBudget || unassignedCount === items.length;

  const startBatch = async () => {
    const runItems: BatchRunItem[] = items.map(i => ({
      id: i.id,
      file: i.file,
      kind: i.kind,
      posterBlob: i.posterBlob,
      durationSeconds: i.durationSeconds,
    }));
    await run(runItems, groups, caption.trim());
  };

  const resetBatch = () => {
    items.forEach(i => URL.revokeObjectURL(i.previewUrl));
    previewUrlsRef.current = [];
    setItems([]);
    setCaption('');
    setPickError(null);
  };

  if (!FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES || loading || !initialAuthCheckComplete || !user) {
    return (
      <div className="min-h-screen bg-canvas">
        <AppHeader showSearch={false} />
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand mx-auto my-24"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas">
      <AppHeader showSearch={false} />
      <main className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
          <h1 className="text-2xl font-bold text-primary">Family upload</h1>
          <Link
            href="/app/guardian"
            className="px-3 py-2 min-h-[44px] inline-flex items-center border border-border-strong rounded-lg text-sm font-semibold text-secondary hover:bg-surface-muted transition-colors"
          >
            Back to console
          </Link>
        </div>
        <p className="text-sm text-tertiary mb-6">
          Pick a batch of photos or videos once, choose which athletes each one
          belongs to, and it posts to their profiles — attributed to you.
        </p>

        {rosterState === 'loading' ? (
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand mx-auto my-12"></div>
        ) : rosterState === 'error' ? (
          <div role="alert" className="bg-surface border border-border rounded-lg p-8 text-center text-sm text-red-600 dark:text-red-400">
            Could not load your athletes. Refresh to try again.
          </div>
        ) : athleteOptions.length === 0 ? (
          <div className="bg-surface border border-border rounded-lg p-8 text-center">
            <p className="text-sm text-secondary mb-4">
              No supervised athletes on your console yet — add one first.
            </p>
            <Link
              href="/app/guardian/add-athlete"
              className="inline-flex items-center gap-2 px-4 py-2 min-h-[44px] bg-brand hover:bg-brand-hover text-white rounded-lg text-sm font-semibold transition-colors"
            >
              <i className="fas fa-plus text-xs"></i>
              Add athlete
            </Link>
          </div>
        ) : outcome && !running ? (
          <div className="bg-surface border border-border rounded-lg p-6">
            <h2 className="text-lg font-bold text-primary mb-2">
              {outcome.postsCreated > 0 ? 'Batch posted' : 'Nothing posted'}
            </h2>
            <p className="text-sm text-secondary mb-1">
              {outcome.postsCreated} post{outcome.postsCreated === 1 ? '' : 's'} created
              {outcome.eventsAttached > 0
                ? `, ${outcome.eventsAttached} attached to a calendar event.`
                : '.'}
            </p>
            {outcome.failures.length > 0 && (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400 mb-1">
                {outcome.failures.length} step{outcome.failures.length === 1 ? '' : 's'} failed.{' '}
                {outcome.failures[0]}
              </p>
            )}
            <div className="flex flex-wrap gap-3 mt-4">
              <Link
                href="/app/guardian"
                className="px-4 py-2 min-h-[44px] inline-flex items-center bg-brand hover:bg-brand-hover text-white rounded-lg text-sm font-semibold transition-colors"
              >
                Back to console
              </Link>
              <button
                type="button"
                onClick={resetBatch}
                className="px-4 py-2 min-h-[44px] inline-flex items-center border border-border-strong rounded-lg text-sm font-semibold text-secondary hover:bg-surface-muted transition-colors"
              >
                Start another batch
              </button>
            </div>
          </div>
        ) : (
          <>
            <input
              ref={inputRef}
              type="file"
              accept="image/*,video/*"
              multiple
              className="hidden"
              onChange={e => handleFiles(e.target.files)}
            />
            <CaptureInputs onFiles={handleFiles} allowVideo>
              {({ openPhoto, openVideo }) => (
                <div className="flex flex-wrap gap-2 mb-3">
                  <button
                    type="button"
                    onClick={openPhoto}
                    disabled={running || items.length >= MAX_ITEMS}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-brand px-4 py-2 font-bold text-white transition-colors hover:bg-brand-hover disabled:opacity-60"
                  >
                    <i className="fas fa-camera" aria-hidden="true"></i>
                    Take photo
                  </button>
                  <button
                    type="button"
                    onClick={openVideo}
                    disabled={running || items.length >= MAX_ITEMS}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-brand px-4 py-2 font-bold text-white transition-colors hover:bg-brand-hover disabled:opacity-60"
                  >
                    <i className="fas fa-video" aria-hidden="true"></i>
                    Record video
                  </button>
                  <button
                    type="button"
                    onClick={() => inputRef.current?.click()}
                    disabled={running || items.length >= MAX_ITEMS}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border-2 border-border-strong px-4 py-2 font-bold text-secondary transition-colors hover:border-violet-500 hover:bg-brand-soft disabled:opacity-60"
                  >
                    <i className="fas fa-images" aria-hidden="true"></i>
                    Choose from library
                  </button>
                </div>
              )}
            </CaptureInputs>
            {pickError && (
              <p role="alert" className="text-xs font-semibold text-red-600 dark:text-red-400 mb-3">
                {pickError}
              </p>
            )}
            {anyBlocked && (
              <p className="text-xs text-tertiary mb-3">
                Athletes without approved consent can&apos;t be posted for yet — finish
                consent from the console first.
              </p>
            )}

            {items.length > 0 && (
              <div className="space-y-3 mb-6">
                {items.map(item => (
                  <BatchUploadItemCard
                    key={item.id}
                    itemId={item.id}
                    previewUrl={item.previewUrl}
                    kind={item.kind}
                    athletes={athleteOptions}
                    assigned={item.athleteIds}
                    suggestions={suggestionsByItem.get(item.id) ?? []}
                    disabled={running}
                    onToggleAthlete={athleteId => toggleAthlete(item.id, athleteId)}
                    onSuggestionDecision={(athleteId, decision) =>
                      decideSuggestion(item.id, athleteId, decision)
                    }
                    onRemove={() => removeItem(item.id)}
                  />
                ))}
              </div>
            )}

            {items.length > 0 && (
              <div className="bg-surface border border-border rounded-lg p-4">
                <label htmlFor="batch-caption" className="block text-sm font-medium text-secondary mb-1">
                  Caption <span className="text-muted font-normal">(shared by every post, optional)</span>
                </label>
                <textarea
                  id="batch-caption"
                  value={caption}
                  onChange={e => setCaption(e.target.value.slice(0, 2000))}
                  rows={2}
                  disabled={running}
                  placeholder="Great day at the meet!"
                  className="w-full border border-border-strong rounded-lg px-3 py-2 text-sm text-primary bg-surface resize-none"
                />
                <div className="flex flex-wrap items-center justify-between gap-3 mt-3">
                  <p className="text-sm text-secondary">
                    {groups.length === 0
                      ? 'Choose at least one athlete for a file.'
                      : `Will create ${groups.length} post${groups.length === 1 ? '' : 's'} across ${athleteCount} athlete${athleteCount === 1 ? '' : 's'}.`}
                    {unassignedCount > 0 && groups.length > 0 && (
                      <span className="text-muted"> {unassignedCount} file{unassignedCount === 1 ? '' : 's'} unassigned — they&apos;ll be skipped.</span>
                    )}
                  </p>
                  <button
                    type="button"
                    onClick={() => void startBatch()}
                    disabled={startDisabled}
                    className="px-4 py-2 min-h-[44px] inline-flex items-center gap-2 bg-brand hover:bg-brand-hover text-white rounded-lg text-sm font-bold transition-colors disabled:opacity-50"
                  >
                    {running && <i className="fas fa-spinner fa-spin" aria-hidden="true"></i>}
                    {running && progress
                      ? `Posting ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
                      : 'Post the batch'}
                  </button>
                </div>
                {overBudget && (
                  <p role="alert" className="text-xs font-semibold text-red-600 dark:text-red-400 mt-2">
                    That&apos;s more than one batch can safely carry — split it into two
                    smaller batches.
                  </p>
                )}
              </div>
            )}
          </>
        )}

        {editorAssets && (
          <MediaEditor
            assets={editorAssets}
            config={EDITOR_CONFIG}
            onDone={handleEditorDone}
            onCancel={() => setEditorAssets(null)}
          />
        )}
      </main>
    </div>
  );
}
