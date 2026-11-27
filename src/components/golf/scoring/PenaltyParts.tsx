'use client';

import { useRef, useState } from 'react';
import { PENALTY_LABELS, PENALTY_STROKES_DEFAULT, PENALTY_STROKES_MAX, PENALTY_STROKES_MIN, PENALTY_TYPES, isPenaltyType, type PenaltyEntry, type PenaltyType } from '@/lib/golf/penalties';
import { CameraIcon, CloseIcon, UpDownIcon, VideoIcon, WarningIcon } from './icons';

// The action row, the penalty entry that swaps in for it, and the stack of
// the hole's penalties (Tom's live-round spec, Nov 25 2026 — C7, C8).
// A penalty is a TYPE and its STROKES (migration 320). Descriptive: nothing
// here changes the strokes on the dial — the golfer enters total strokes.

function ActionButton({ label, colour, ring, onClick, disabled, badge, hook, children }: {
  label: string;
  colour: string;
  /** The colour at a third, for the ring. */
  ring: string;
  onClick: () => void;
  disabled?: boolean;
  badge?: number;
  hook: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={badge !== undefined ? `${label}, ${badge} penalty stroke${badge === 1 ? '' : 's'} on this hole` : label}
        data-scorer-action={hook}
        className="ea-mech-btn relative inline-flex h-[52px] w-[52px] items-center justify-center rounded-full disabled:opacity-40"
        style={{ backgroundColor: 'var(--mech-tile)', boxShadow: `inset 0 0 0 1.5px ${ring}`, color: colour }}
      >
        {children}
        {badge !== undefined && (
          <span
            aria-hidden="true"
            className="ea-mech-readout absolute -right-1 -top-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded-[10px] px-1 text-[11px]"
            style={badge > 0
              ? { backgroundColor: 'var(--mech-bad-text)', color: 'var(--mech-surface)', boxShadow: '0 0 0 2px var(--mech-surface)' }
              : { backgroundColor: 'var(--mech-key)', color: 'var(--mech-text-soft)', boxShadow: '0 0 0 2px var(--mech-surface)' }}
            data-penalty-badge=""
          >
            {badge}
          </span>
        )}
      </button>
      <span className="ea-mech-micro" aria-hidden="true">{label}</span>
    </div>
  );
}

/** C7 — Penalty, Photo, Video. Photo and Video open the phone's own chooser
 *  (camera or library): the separate Library button is gone. */
export function ActionRow({ penaltyStrokes, onPenalty, onMedia, mediaEnabled, mediaBusy, mediaCount }: {
  penaltyStrokes: number;
  onPenalty: () => void;
  onMedia: (file: File | undefined) => void;
  mediaEnabled: boolean;
  mediaBusy: boolean;
  mediaCount: number;
}) {
  const photoRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  // The input clears itself after a pick, so the same file can be picked again.
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    onMedia(e.target.files?.[0]);
    e.target.value = '';
  };
  return (
    <div className="grid h-[70px] grid-cols-3 items-start" data-scorer-actions="" data-media-count={mediaCount}>
      <ActionButton label="Penalty" colour="var(--mech-danger)" ring="var(--mech-danger-ring)" onClick={onPenalty} badge={penaltyStrokes} hook="penalty">
        <WarningIcon size={22} />
      </ActionButton>
      {/* No `capture`: the phone offers the camera or the library itself. */}
      <input ref={photoRef} type="file" accept="image/*" className="hidden" onChange={pick} data-scorer-photo-input="" />
      <input ref={videoRef} type="file" accept="video/*" className="hidden" onChange={pick} data-scorer-video-input="" />
      <ActionButton label="Photo" colour="var(--mech-media)" ring="var(--mech-media-ring)" onClick={() => photoRef.current?.click()} disabled={!mediaEnabled || mediaBusy} hook="photo">
        <CameraIcon size={22} />
      </ActionButton>
      <ActionButton label="Video" colour="var(--mech-media)" ring="var(--mech-media-ring)" onClick={() => videoRef.current?.click()} disabled={!mediaEnabled || mediaBusy} hook="video">
        <VideoIcon size={22} />
      </ActionButton>
    </div>
  );
}

/** X3 — the entry that takes the action row's place: type, strokes, Add, Cancel. */
export function PenaltyEntryRow({ onAdd, onCancel, full }: { onAdd: (entry: PenaltyEntry) => void; onCancel: () => void; full: boolean }) {
  const [type, setType] = useState<PenaltyType | ''>('');
  const [strokes, setStrokes] = useState(String(PENALTY_STROKES_DEFAULT));
  const value = Math.min(PENALTY_STROKES_MAX, Math.max(PENALTY_STROKES_MIN, Math.floor(Number(strokes)) || PENALTY_STROKES_DEFAULT));
  return (
    <div className="flex h-[70px] items-start gap-2" data-penalty-entry="">
      <label className="relative block h-[52px] min-w-0 flex-1 rounded-xl" style={{ backgroundColor: 'var(--mech-tile)', boxShadow: 'inset 0 0 0 1.5px var(--mech-danger-ring)' }}>
        <span className="sr-only">Penalty type</span>
        <select
          value={type}
          onChange={e => setType(isPenaltyType(e.target.value) ? e.target.value : '')}
          className="absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-xl bg-transparent pl-3 pr-8 text-base font-semibold text-[color:var(--mech-text)] sm:text-sm"
          data-penalty-type=""
        >
          <option value="">Penalty type</option>
          {PENALTY_TYPES.map(t => (
            <option key={t} value={t}>{PENALTY_LABELS[t]}</option>
          ))}
        </select>
        <UpDownIcon size={16} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[color:var(--mech-label)]" />
      </label>
      <label className="ea-mech-recess block h-[52px] w-[52px] shrink-0 rounded-xl">
        <span className="sr-only">Penalty strokes</span>
        <input
          type="number"
          inputMode="numeric"
          min={PENALTY_STROKES_MIN}
          max={PENALTY_STROKES_MAX}
          value={strokes}
          onChange={e => setStrokes(e.target.value)}
          onBlur={() => setStrokes(String(value))}
          className="ea-mech-slot-input ea-mech-readout h-full w-full text-center text-base"
          data-penalty-strokes=""
        />
      </label>
      <button
        type="button"
        onClick={() => { if (type) onAdd({ type, strokes: value }); }}
        disabled={!type || full}
        className="ea-mech-btn h-[52px] w-[72px] shrink-0 rounded-[26px] text-sm font-bold disabled:opacity-40"
        style={{ backgroundColor: 'var(--mech-danger)', color: 'var(--mech-on-danger)' }}
        data-penalty-add=""
      >
        Add
      </button>
      <button type="button" onClick={onCancel} aria-label="Cancel the penalty" className="ea-mech-btn inline-flex h-[52px] w-11 shrink-0 items-center justify-center text-[color:var(--mech-text-soft)]" data-penalty-cancel="">
        <CloseIcon size={16} />
      </button>
    </div>
  );
}

/** C8 — one row per penalty on this hole, newest at the bottom. */
export function PenaltyStack({ entries, onRemove, disabled }: { entries: readonly PenaltyEntry[]; onRemove: (index: number) => void; disabled?: boolean }) {
  if (entries.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1.5" data-penalty-stack="">
      {entries.map((entry, i) => (
        <li key={`${i}-${entry.type}-${entry.strokes}`} className="ea-mech-penalty flex h-11 items-center gap-2.5 rounded-xl pl-3" data-penalty-row={entry.type}>
          <WarningIcon size={16} className="shrink-0 text-[color:var(--mech-danger)]" />
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[color:var(--mech-text)]">{PENALTY_LABELS[entry.type]}</span>
          <span className="ea-mech-readout shrink-0 text-[13px]" style={{ color: 'var(--mech-danger-text)' }} data-penalty-row-strokes="">+{entry.strokes}</span>
          <button
            type="button"
            onClick={() => onRemove(i)}
            disabled={disabled}
            aria-label={`Remove ${PENALTY_LABELS[entry.type]}, ${entry.strokes} stroke${entry.strokes === 1 ? '' : 's'}`}
            className="ea-mech-btn inline-flex h-11 w-11 shrink-0 items-center justify-center text-[color:var(--mech-close-icon)]"
            data-penalty-remove=""
          >
            <CloseIcon size={14} />
          </button>
        </li>
      ))}
    </ul>
  );
}
