'use client';

import { useState } from 'react';
import ConfirmModal from '@/components/ConfirmModal';
import SectionInfo from '@/components/SectionInfo';
import { markNowOffsetMs } from '@/lib/videos/live-rules';
import { formatTimestamp, HIGHLIGHT_HOLE_MAX, HIGHLIGHT_LABEL_MAX, parseTypedTimestamp, type HighlightInput } from '@/lib/videos/rules';
import type { HighlightRow } from '@/lib/videos/types';
import TagFields, { EMPTY_TAG_DRAFT, tagDraftOf, tagInputOf, type TagDraft } from '@/components/videos/TagFields';
import { gameSheetFor, sheetEvent, type GameSheet } from '@/lib/videos/game-sheets';
import { sideLabel, type GameView } from '@/lib/videos/game-rules';
import { clipAround, defaultTagLabel, nudgeMs, ROLE_IN_CLIP } from '@/lib/videos/tag-rules';
import FaIcon from '@/components/FaIcon';
import { faPen } from '@/lib/icons/fa/pen';
import { faPlay } from '@/lib/icons/fa/play';
import { faTrash } from '@/lib/icons/fa/trash';

const FIELD = 'w-full border border-border-strong rounded-lg px-3 min-h-[44px] text-base bg-surface text-primary';
const BTN = 'ea-interactive border border-border-strong text-secondary px-3 min-h-[44px] rounded-lg text-sm font-semibold disabled:opacity-60';

interface Props {
  highlights: HighlightRow[];
  canManage: boolean;
  /** The marker the player is on, for the row's pressed state. */
  activeId: string | null;
  onPlay: (h: HighlightRow) => void;
  onAdd: (input: HighlightInput) => Promise<string | null>;
  onEdit: (id: string, input: HighlightInput) => Promise<string | null>;
  onDelete: (id: string) => Promise<string | null>;
  /** Phase 4a: YouTube's actual start while the broadcast is LIVE — the "Now" button's zero; null otherwise. */
  liveStartedAt?: string | null;
  /** Polish B: the player's playhead in ms when the IFrame API answers — "Mark this moment"; null/undefined = no such button. */
  currentMs?: () => number | null;
  /** Sprint 3: the video is a game — a highlight may be tagged with the sport's event and the people in it. */
  game?: GameView | null;
  durationMs?: number | null;
  /** The video being tagged: the form reads who its owner already knows (rosters, connections). */
  videoId?: string;
}

interface Draft {
  time: string;
  end: string;
  label: string;
  hole: string;
  score: string;
  note: string;
  /** Set by "Now": the server stamps the time from its own clock (meta.live). */
  live: boolean;
  tag: TagDraft;
}

const EMPTY: Draft = { time: '', end: '', label: '', hole: '', score: '', note: '', live: false, tag: EMPTY_TAG_DRAFT };

function draftOf(h: HighlightRow, sheet: GameSheet | null): Draft {
  return {
    tag: tagDraftOf(h, sheet),
    time: formatTimestamp(h.start_ms),
    end: h.end_ms === null ? '' : formatTimestamp(h.end_ms),
    label: h.label,
    hole: h.meta?.hole === undefined ? '' : String(h.meta.hole),
    score: h.meta?.score === undefined ? '' : String(h.meta.score),
    note: h.meta?.note ?? '',
    live: false,
  };
}

function inputOf(d: Draft, sheet: GameSheet | null): { ok: true; value: HighlightInput } | { ok: false; error: string } {
  const start = parseTypedTimestamp(d.time);
  if (start === null) return { ok: false, error: 'Type the time as m:ss or h:mm:ss (for example 12:30).' };
  let end: number | null = null;
  if (d.end.trim()) {
    end = parseTypedTimestamp(d.end);
    if (end === null) return { ok: false, error: 'Type the end as m:ss or h:mm:ss.' };
    if (end <= start) return { ok: false, error: 'The end must come after the start.' };
  }
  // A tagged event names itself when nothing was typed ("3-pointer made — Ann Lee").
  const firstTagged = d.tag.people.find(p => p.role !== ROLE_IN_CLIP)?.name ?? null;
  const label = d.label.trim() || (defaultTagLabel(sheet, { event_key: d.tag.eventKey || null }, firstTagged) ?? '');
  if (!label) return { ok: false, error: 'Give the moment a name.' };
  if (label.length > HIGHLIGHT_LABEL_MAX) return { ok: false, error: `Keep the name to ${HIGHLIGHT_LABEL_MAX} characters.` };
  const meta: HighlightInput['meta'] = {};
  if (d.hole.trim()) {
    const n = Number(d.hole);
    if (!Number.isInteger(n) || n < 1 || n > HIGHLIGHT_HOLE_MAX) return { ok: false, error: `Hole must be 1 to ${HIGHLIGHT_HOLE_MAX}.` };
    meta.hole = n;
  }
  if (d.score.trim()) {
    const n = Number(d.score);
    if (!Number.isInteger(n)) return { ok: false, error: 'Score must be a whole number.' };
    meta.score = n;
  }
  if (d.note.trim()) meta.note = d.note.trim();
  if (d.live) meta.live = true;
  if (!sheet) return { ok: true, value: { start_ms: start, end_ms: end, label, meta } };
  const tag = tagInputOf(d.tag, sheet);
  if (!tag.ok) return tag;
  return { ok: true, value: { start_ms: start, end_ms: end, label, meta, tag: tag.value } };
}

function HighlightForm({ initial, onSave, onCancel, saving, liveStartedAt = null, currentMs, game = null, durationMs = null, videoId }: { initial: Draft; onSave: (input: HighlightInput) => Promise<string | null>; onCancel: () => void; saving: boolean; liveStartedAt?: string | null; currentMs?: () => number | null; game?: GameView | null; durationMs?: number | null; videoId?: string }) {
  const sheet = game ? gameSheetFor(game.sport_key) : null;
  const [d, setD] = useState<Draft>(initial);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement>) => setD(prev => ({ ...prev, [k]: e.target.value, ...(k === 'time' ? { live: false } : {}) }));
  // "Now" (Phase 4a): the offset into the LIVE stream from YouTube's actual start; the server re-stamps it from its own clock.
  const markNow = () => {
    const offset = markNowOffsetMs(liveStartedAt, Date.now());
    if (offset === null) return;
    setD(prev => ({ ...prev, time: formatTimestamp(offset), live: true }));
  };
  // "Mark this moment" (polish B): the playhead the IFrame API reports — a VOD's moment, typed for you; the live "Now" keeps the server's stamp.
  const canMark = !!currentMs && !liveStartedAt;
  const markMoment = () => {
    const ms = currentMs?.();
    if (ms === null || ms === undefined) return;
    // On a game the moment becomes a clip: a lead-in before it and a tail after (both nudgeable).
    if (sheet) {
      const clip = clipAround(ms, durationMs);
      setD(prev => ({ ...prev, time: formatTimestamp(clip.start_ms), end: formatTimestamp(clip.end_ms), live: false }));
      return;
    }
    setD(prev => ({ ...prev, time: formatTimestamp(ms), live: false }));
  };
  const endHere = () => {
    const ms = currentMs?.();
    if (ms === null || ms === undefined) return;
    setD(prev => ({ ...prev, end: formatTimestamp(ms) }));
  };
  const nudge = (k: 'time' | 'end', deltaMs: number) => setD(prev => {
    const at = parseTypedTimestamp(prev[k]);
    return at === null ? prev : { ...prev, [k]: formatTimestamp(nudgeMs(at, deltaMs, durationMs)), live: false };
  });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = inputOf(d, sheet);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setError(null);
    const err = await onSave(parsed.value);
    if (err) setError(err);
  };
  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-border bg-surface-muted p-3" data-highlight-form="">
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm text-secondary">
          Starts at
          <div className="mt-1 flex gap-2">
            <input className={FIELD} inputMode="numeric" placeholder="12:30" value={d.time} onChange={set('time')} data-highlight-time="" />
            {liveStartedAt && (
              <button type="button" onClick={markNow} className={`${BTN} shrink-0`} title="This moment of the live stream" data-highlight-now="">
                Now
              </button>
            )}
            {canMark && (
              <button type="button" onClick={markMoment} className={`${BTN} shrink-0`} title="The moment the player is at" data-highlight-mark="">
                This moment
              </button>
            )}
          </div>
        </label>
        <label className="block text-sm text-secondary">
          Ends at (optional)
          <div className="mt-1 flex gap-2">
            <input className={FIELD} inputMode="numeric" placeholder="13:05" value={d.end} onChange={set('end')} data-highlight-end="" />
            {sheet && canMark && (
              <button type="button" onClick={endHere} className={`${BTN} shrink-0`} title="End the clip where the player is" data-highlight-end-here="">
                End here
              </button>
            )}
          </div>
        </label>
      </div>
      {sheet && (
        <div className="flex flex-wrap gap-2" data-highlight-nudge="">
          <button type="button" onClick={() => nudge('time', -5000)} className={BTN} data-highlight-nudge-start="-5">Start −5s</button>
          <button type="button" onClick={() => nudge('time', 5000)} className={BTN} data-highlight-nudge-start="5">Start +5s</button>
          <button type="button" onClick={() => nudge('end', -5000)} className={BTN} data-highlight-nudge-end="-5">End −5s</button>
          <button type="button" onClick={() => nudge('end', 5000)} className={BTN} data-highlight-nudge-end="5">End +5s</button>
        </div>
      )}
      {sheet && game && <TagFields sheet={sheet} game={game} value={d.tag} onChange={tag => setD(prev => ({ ...prev, tag }))} videoId={videoId} />}
      <label className="block text-sm text-secondary">
        {sheet ? 'Name it (optional — a tagged event names itself)' : 'What happens'}
        <input className={`${FIELD} mt-1`} maxLength={HIGHLIGHT_LABEL_MAX} placeholder={sheet ? (defaultTagLabel(sheet, { event_key: d.tag.eventKey || null }) ?? 'Great play') : 'Eagle on 7'} value={d.label} onChange={set('label')} data-highlight-label="" />
      </label>
      {(!sheet || sheet.family === 'golf') && <div className="grid grid-cols-3 gap-3">
        <label className="block text-sm text-secondary">
          Hole
          <input className={`${FIELD} mt-1`} inputMode="numeric" value={d.hole} onChange={set('hole')} />
        </label>
        <label className="block text-sm text-secondary">
          Score
          <input className={`${FIELD} mt-1`} inputMode="numeric" value={d.score} onChange={set('score')} />
        </label>
        <label className="block text-sm text-secondary col-span-1">
          Note
          <input className={`${FIELD} mt-1`} value={d.note} onChange={set('note')} />
        </label>
      </div>}
      <p className="text-xs text-muted">{sheet ? 'Pause the video on the play and press This moment — the clip starts a few seconds before and ends a few after; nudge either end. The stats are built from what you tag here.' : 'The time is where the player starts — to the second, as YouTube seeks. Read it off the player and type it here.'}</p>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className={BTN}>Cancel</button>
        <button type="submit" disabled={saving} className="ea-cta px-4 min-h-[44px] rounded-lg text-sm font-semibold text-white disabled:opacity-60" data-highlight-save="">
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}

/**
 * The markers (Videos program, 296): in time order, each a tap that starts
 * the player there; a manager adds, edits and removes them. The count is in
 * the heading. A marker is a cue — an end is a note on it, never a cut.
 */
export default function HighlightList({ highlights, canManage, activeId, onPlay, onAdd, onEdit, onDelete, liveStartedAt = null, currentMs, game = null, durationMs = null, videoId }: Props) {
  const sheet = game ? gameSheetFor(game.sport_key) : null;
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<HighlightRow | null>(null);
  const [saving, setSaving] = useState(false);
  const n = highlights.length;

  const run = async (fn: () => Promise<string | null>) => {
    setSaving(true);
    try {
      return await fn();
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="bg-surface rounded-lg border border-border p-4 sm:p-6" aria-labelledby="video-highlights-heading" data-video-highlights={n}>
      <SectionInfo
        heading={`${n} ${n === 1 ? 'highlight' : 'highlights'}`}
        label="highlights"
        headingId="video-highlights-heading"
        trailing={canManage && !adding ? (
          <button type="button" onClick={() => { setAdding(true); setEditing(null); }} className={BTN} data-highlight-add="">
            Add highlight
          </button>
        ) : null}
      >
        A highlight is a bookmark into the video: tap one and the player starts there. It never cuts the video — the whole game stays watchable, and the marks are visible to everyone who can see the video.
      </SectionInfo>

      {adding && (
        <div className="mt-4">
          <HighlightForm
            videoId={videoId}
            initial={EMPTY}
            liveStartedAt={liveStartedAt}
            currentMs={currentMs}
            game={game}
            durationMs={durationMs}
            saving={saving}
            onCancel={() => setAdding(false)}
            onSave={input => run(async () => {
              const err = await onAdd(input);
              if (!err) setAdding(false);
              return err;
            })}
          />
        </div>
      )}

      {n === 0 && !adding && (
        <p className="mt-4 text-sm text-muted" data-video-highlights-empty="">
          {canManage ? (sheet ? 'No highlights yet. Pause on a play and tag what happened and who was in it.' : 'No highlights yet. Add the moments worth jumping to.') : 'No highlights yet.'}
        </p>
      )}

      {n > 0 && (
        <ol className="mt-4 divide-y divide-border">
          {highlights.map(h => (
            <li key={h.id} className="py-1" data-video-highlight={h.id}>
              {editing === h.id ? (
                <HighlightForm
                  videoId={videoId}
                  initial={draftOf(h, sheet)}
                  currentMs={currentMs}
                  game={game}
                  durationMs={durationMs}
                  saving={saving}
                  onCancel={() => setEditing(null)}
                  onSave={input => run(async () => {
                    const err = await onEdit(h.id, input);
                    if (!err) setEditing(null);
                    return err;
                  })}
                />
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onPlay(h)}
                    aria-pressed={activeId === h.id}
                    className={`ea-interactive flex-1 min-w-0 flex items-center gap-3 text-left rounded-lg px-2 min-h-[44px] ${activeId === h.id ? 'bg-brand-soft' : 'hover:bg-surface-muted'}`}
                    data-highlight-play={h.id}
                  >
                    <span className="font-mono text-sm text-brand-fg shrink-0 w-16">{formatTimestamp(h.start_ms)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-primary truncate">
                        {sheet && sheetEvent(sheet, h.event_key) && <span className="mr-2 inline-block rounded bg-surface-muted px-1.5 py-0.5 font-mono text-xs font-semibold text-secondary align-middle" data-highlight-event={h.event_key ?? ''}>{sheetEvent(sheet, h.event_key)!.short}</span>}
                        {h.label}
                      </span>
                      {(h.people.length > 0 || (game && h.side)) && (
                        <span className="block text-xs text-secondary truncate" data-highlight-people={h.people.length}>
                          {[game && h.side ? sideLabel(game, h.side) : null, h.people.map(p => p.name).join(', ') || null].filter(Boolean).join(' · ')}
                        </span>
                      )}
                      {(h.meta?.hole !== undefined || h.meta?.score !== undefined || h.meta?.note || h.end_ms !== null) && (
                        <span className="block text-xs text-muted truncate">
                          {[
                            h.meta?.hole !== undefined ? `Hole ${h.meta.hole}` : null,
                            h.meta?.score !== undefined ? `Score ${h.meta.score}` : null,
                            h.end_ms !== null ? `to ${formatTimestamp(h.end_ms)}` : null,
                            h.meta?.note ?? null,
                          ].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </span>
                    <FaIcon icon={faPlay} className="text-xs text-muted shrink-0" />
                  </button>
                  {canManage && (
                    <>
                      <button type="button" onClick={() => { setEditing(h.id); setAdding(false); }} className="ea-icon-btn text-secondary" aria-label={`Edit ${h.label}`} data-highlight-edit={h.id}>
                        <FaIcon icon={faPen} className="text-sm" />
                      </button>
                      <button type="button" onClick={() => setRemoving(h)} className="ea-icon-btn text-secondary" aria-label={`Remove ${h.label}`} data-highlight-remove={h.id}>
                        <FaIcon icon={faTrash} className="text-sm" />
                      </button>
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      <ConfirmModal
        isOpen={removing !== null}
        title="Remove this highlight?"
        message={removing ? `"${removing.label}" at ${formatTimestamp(removing.start_ms)} will be removed. The video itself stays.` : ''}
        confirmText="Remove"
        confirmButtonClass="bg-red-600 hover:bg-red-700 text-white"
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          const target = removing;
          setRemoving(null);
          if (target) await run(() => onDelete(target.id));
        }}
      />
    </section>
  );
}
