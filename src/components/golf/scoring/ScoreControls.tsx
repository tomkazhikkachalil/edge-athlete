'use client';

import { AvatarImage } from '@/components/OptimizedImage';
import { getInitials } from '@/lib/formatters';
import { CARD_PUTTS_MIN, puttTone, toneVar, toParCell, toParTab, type CardTotals } from '@/lib/golf/score-card';
import { colourAlpha } from '@/lib/golf/player-colour';
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, MinusIcon, PlusIcon } from './icons';

// The scoring card's controls (Tom's live-round spec, Nov 25 2026): each one
// draws a value its caller holds and reports a tap. All inside `.ea-mech`.

/** C1 — the LIVE badge (red, as everywhere in the app), or FINAL once the round is. */
/** `scope` names the hook: the scoring card's (`data-scorer-status`) or the live page's (`data-live-status`). */
export function RoundBadge({ status, scope = 'scorer' }: { status: 'live' | 'final'; scope?: 'scorer' | 'live' }) {
  const hook = { [`data-${scope}-status`]: status };
  if (status === 'final') {
    return (
      <span className="ea-mech-micro inline-flex h-6 items-center rounded-xl px-[9px]" style={{ backgroundColor: 'var(--mech-tile)', boxShadow: 'inset 0 0 0 1px var(--mech-hairline)' }} {...hook}>
        Final
      </span>
    );
  }
  return (
    <span
      className="inline-flex h-6 items-center gap-1.5 rounded-xl px-[9px]"
      style={{ backgroundColor: 'var(--mech-live-fill)', boxShadow: 'inset 0 0 0 1px var(--mech-live-ring)' }}
      {...hook}
    >
      <span aria-hidden="true" className="inline-block h-[7px] w-[7px] rounded-full motion-safe:animate-pulse" style={{ backgroundColor: 'var(--mech-live)', boxShadow: '0 0 8px var(--mech-live)' }} />
      <span className="ea-mech-micro" style={{ color: 'var(--mech-live-text)' }}>Live</span>
    </span>
  );
}

// ── C2 — the player tabs ─────────────────────────────────────────────────────
export interface PlayerTab {
  participantId: string;
  /** The tab's word: "You", or a first name. */
  name: string;
  /** The whole name: the tab's accessible name and the picture's initials. */
  fullName: string;
  avatarUrl: string | null;
  colour: string;
  /** null before any of their holes is recorded. */
  toPar: number | null;
}

export function PlayerTabs({ tabs, selectedId, onSelect, disabled }: { tabs: readonly PlayerTab[]; selectedId: string; onSelect: (participantId: string) => void; disabled?: boolean }) {
  return (
    <div role="tablist" aria-label="Whose scores" className="ea-mech-scroll -mx-4 flex gap-2 overflow-x-auto px-4 py-0.5" data-scroll-x="" data-scorer-players="">
      {tabs.map(tab => {
        const selected = tab.participantId === selectedId;
        return (
          <button
            key={tab.participantId}
            type="button"
            role="tab"
            aria-selected={selected}
            disabled={disabled}
            onClick={() => onSelect(tab.participantId)}
            data-scorer-player={tab.participantId}
            title={tab.fullName}
            className="ea-mech-btn inline-flex h-11 shrink-0 items-center gap-2 rounded-[22px] pl-1.5 pr-3.5 disabled:opacity-60"
            style={selected
              ? { backgroundColor: colourAlpha(tab.colour, 0.22), boxShadow: `inset 0 0 0 2px ${tab.colour}`, color: 'var(--mech-text)' }
              : { backgroundColor: 'var(--mech-tile)', boxShadow: 'inset 0 0 0 1px var(--mech-hairline)', color: 'var(--mech-text-dim)' }}
          >
            <span className="relative block h-[32px] w-[32px] shrink-0 rounded-full" style={{ boxShadow: `0 0 0 2px ${tab.colour}` }}>
              <AvatarImage src={tab.avatarUrl ?? undefined} alt="" size={32} fallbackInitials={getInitials(tab.fullName)} />
            </span>
            <span className="max-w-[9rem] truncate text-sm font-semibold">{tab.name}</span>
            <span className="ea-mech-readout text-[13px] !text-inherit" data-scorer-player-to-par="">{toParTab(tab.toPar)}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── C5 — the putts capsule ───────────────────────────────────────────────────
export function PuttsCapsule({ putts, max, onChange, onConfirm, disabled }: { putts: number; max: number; onChange: (putts: number) => void; onConfirm: () => void; disabled?: boolean }) {
  return (
    <div
      className="ea-mech-recess flex w-[76px] shrink-0 flex-col items-center justify-between self-stretch rounded-[38px] p-2.5 max-[389px]:w-[68px] max-[389px]:p-1.5"
      role="group"
      aria-label="Putts"
      data-putts-capsule=""
    >
      <button type="button" onClick={() => onChange(putts + 1)} disabled={disabled || putts >= max} aria-label="One putt more" data-putts-plus="" className="ea-mech-round inline-flex h-[56px] w-[56px] items-center justify-center max-[359px]:h-[48px] max-[359px]:w-[48px]">
        <PlusIcon size={22} />
      </button>
      <button
        type="button"
        onClick={onConfirm}
        disabled={disabled}
        aria-label={`${putts} putts, confirm`}
        data-putts-confirm=""
        className="ea-mech-btn flex min-h-[44px] w-full flex-col items-center justify-center rounded-2xl"
      >
        <span className="ea-mech-readout text-[38px] leading-[40px]" style={{ color: toneVar(puttTone(putts)) }} data-putts-number="">{putts}</span>
        <span className="ea-mech-micro">Putts</span>
      </button>
      <button type="button" onClick={() => onChange(putts - 1)} disabled={disabled || putts <= CARD_PUTTS_MIN} aria-label="One putt fewer" data-putts-minus="" className="ea-mech-round inline-flex h-[56px] w-[56px] items-center justify-center max-[359px]:h-[48px] max-[359px]:w-[48px]">
        <MinusIcon size={22} />
      </button>
    </div>
  );
}

// ── C6 — FIR and GIR lamps ───────────────────────────────────────────────────
export function StatLamp({ label, caption, on, onToggle, disabled }: { label: 'FIR' | 'GIR'; caption: string; on: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-pressed={on}
        aria-label={`${caption} in regulation`.replace('Fairway in regulation', 'Fairway hit')}
        data-stat-lamp={label.toLowerCase()}
        className="ea-mech-lamp ea-mech-readout inline-flex h-[64px] w-[64px] items-center justify-center text-sm !text-inherit max-[389px]:h-[56px] max-[389px]:w-[56px]"
      >
        {label}
      </button>
      <span className="ea-mech-micro" aria-hidden="true">{caption}</span>
    </div>
  );
}

// ── C7 — the totals strip ────────────────────────────────────────────────────
export function TotalsStrip({ totals, holesPlayed }: { totals: CardTotals; holesPlayed: number }) {
  const cells: Array<{ label: string; value: string; colour?: string; hook?: string }> = [
    { label: 'Thru', value: `${totals.thru}/${holesPlayed}`, hook: 'thru' },
    { label: 'To par', value: toParCell(totals.toPar), colour: totals.toPar !== null && totals.toPar <= 0 ? 'var(--mech-good-text)' : undefined, hook: 'to-par' },
    { label: 'Strokes', value: String(totals.strokes), hook: 'strokes' },
    { label: 'Putts', value: String(totals.putts), hook: 'putts' },
  ];
  return (
    <dl className="ea-mech-panel grid h-[50px] grid-cols-4 rounded-xl" data-scorer-totals="">
      {cells.map((cell, i) => (
        <div key={cell.label} className="flex min-w-0 flex-col items-center justify-center" style={i > 0 ? { borderLeft: '1px solid var(--mech-hairline)' } : undefined}>
          <dt className="ea-mech-micro">{cell.label}</dt>
          <dd className="ea-mech-readout text-[15px] leading-5" style={cell.colour ? { color: cell.colour } : undefined} {...(cell.hook === 'to-par' ? { 'data-scorer-to-par': '' } : {})} data-scorer-total={cell.hook}>
            {cell.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// ── C7 — the hole keys ───────────────────────────────────────────────────────
export function HoleKeys({ rows, current, recorded, colour, onJump, disabled }: {
  rows: readonly number[][];
  /** The hole NUMBER on the card. */
  current: number;
  recorded: ReadonlySet<number>;
  /** The selected player's colour: the current key's ring. */
  colour: string;
  onJump: (holeNumber: number) => void;
  disabled?: boolean;
}) {
  return (
    <nav aria-label="Jump to a hole" className="flex flex-col gap-1.5" data-hole-keys="">
      {rows.map(row => (
        <div key={row[0]} className="grid gap-1" style={{ gridTemplateColumns: 'repeat(9, minmax(0, 1fr))' }}>
          {row.map(n => {
            const isCurrent = n === current;
            const isRecorded = recorded.has(n);
            return (
              <button
                key={n}
                type="button"
                onClick={() => onJump(n)}
                disabled={disabled}
                aria-current={isCurrent ? 'true' : undefined}
                aria-label={`Hole ${n}${isRecorded ? ', recorded' : ''}`}
                data-hole-key={n}
                {...(isRecorded ? { 'data-recorded': '' } : {})}
                className="ea-mech-holekey ea-mech-readout h-10 min-w-0 text-[13px] !text-inherit"
                style={isCurrent ? { boxShadow: `inset 0 0 0 2px ${colour}` } : undefined}
              >
                {n}
                {isRecorded && (
                  <span aria-hidden="true" className="absolute right-0.5 top-0.5 inline-flex h-[13px] w-[13px] items-center justify-center rounded-full" style={{ backgroundColor: 'var(--mech-good)', color: 'var(--mech-on-good)' }} data-hole-key-check="">
                    <CheckIcon size={9} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

// ── C9 — the footer ──────────────────────────────────────────────────────────
export function ScoreFooter({ onPrevious, onNext, nextLabel, first, busy, busyLabel }: {
  onPrevious: () => void;
  onNext: () => void;
  /** "Hole 7", "Finish round", "Done", "Save Scores". */
  nextLabel: string;
  first: boolean;
  busy: boolean;
  busyLabel: string;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2.5" data-scorer-footer="">
      <button
        type="button"
        onClick={onPrevious}
        disabled={first || busy}
        aria-label="Previous hole"
        data-scorer-previous=""
        className="ea-mech-btn inline-flex h-[56px] w-[56px] shrink-0 items-center justify-center rounded-full text-[color:var(--mech-text)] disabled:opacity-40"
        style={{ border: '1px solid var(--mech-outline)' }}
      >
        <ChevronLeftIcon size={22} />
      </button>
      <button type="button" onClick={onNext} disabled={busy} data-scorer-next="" className="ea-mech-go inline-flex h-[56px] min-w-0 flex-1 items-center justify-center gap-1.5 px-4">
        <span className="truncate">{busy ? busyLabel : nextLabel}</span>
        {!busy && <ChevronRightIcon size={20} />}
      </button>
    </div>
  );
}
