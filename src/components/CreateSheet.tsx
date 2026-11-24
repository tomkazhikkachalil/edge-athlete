'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Activity, Dumbbell, Flag, Info, Medal, Pencil, SquarePlay, X } from 'lucide-react';
import LargerWindow from '@/components/bubbles/LargerWindow';
import { CREATE_OPTIONS, CREATE_PICK_BEAT_MS, toggleInfo, type CreateOption, type CreateOptionKey } from '@/lib/create-options';

/**
 * The header's Create sheet as a tile grid (Tom's spec, Nov 23 2026): the
 * SAME six doors in the same order as Nov 20 — Post (the page's own composer,
 * else the feed's ?create=1 handoff), Sport session (the composer with the
 * sport picker open), Gym workout (useStartWorkout, the one start path),
 * Live activity (the recorder), Event & leaderboard (the wizard) and Game
 * highlights (/videos/new) — drawn as a full-width Post button, a 2 x 2
 * grid and a full-width last row. Titles only; each option's one-line
 * description sits behind its info button and swaps in IN PLACE: every
 * option has a fixed height, so nothing on the sheet ever moves.
 *
 * One option = a box with two sibling buttons (never nested): the option
 * (named by its title, `aria-pressed`, the `data-create-<key>` hook every
 * spec clicks) and the info button ("About <title>", `aria-expanded`, 44 px).
 * One info text open at a time (`toggleInfo`); all closed when the sheet
 * opens (the state lives here and the sheet mounts on open). A tap on an
 * option marks it selected, closes any info text and opens its flow after a
 * short beat, so the tap is always answered on screen; Post is solid brand
 * only while nothing is selected. The look per state is `.ea-create-opt` in
 * globals.css. The drawer opens this same sheet; it is the one Create menu
 * at every width.
 */
const ICONS: Record<CreateOptionKey, ReactNode> = {
  post: <Pencil size={20} strokeWidth={2} aria-hidden="true" />,
  sport: <Medal size={20} strokeWidth={2} aria-hidden="true" />,
  workout: <Dumbbell size={20} strokeWidth={2} aria-hidden="true" />,
  recording: <Activity size={20} strokeWidth={2} aria-hidden="true" />,
  event: <Flag size={20} strokeWidth={2} aria-hidden="true" />,
  'full-game': <SquarePlay size={20} strokeWidth={2} aria-hidden="true" />,
};

export default function CreateSheet({ onPost, onSport, onEvent, onFullGame, onWorkout, onRecording, onClose }: { onPost: () => void; onSport: () => void; onEvent: () => void; onFullGame: () => void; onWorkout: () => void; onRecording: () => void; onClose: () => void }) {
  const [infoOpen, setInfoOpen] = useState<CreateOptionKey | null>(null);
  const [selected, setSelected] = useState<CreateOptionKey | null>(null);
  const [pressed, setPressed] = useState<CreateOptionKey | null>(null);
  const beat = useRef<number | null>(null);
  const ids = useId();
  useEffect(() => () => { if (beat.current !== null) window.clearTimeout(beat.current); }, []);

  const open: Record<CreateOptionKey, () => void> = { post: onPost, sport: onSport, workout: onWorkout, recording: onRecording, event: onEvent, 'full-game': onFullGame };
  const pick = (key: CreateOptionKey) => {
    if (selected !== null) return; // one pick per opening: a second tap during the beat does nothing
    setSelected(key);
    setInfoOpen(null);
    beat.current = window.setTimeout(open[key], CREATE_PICK_BEAT_MS);
  };

  const option = (o: CreateOption) => {
    const isOpen = infoOpen === o.key;
    const isSelected = selected === o.key;
    const solid = o.shape === 'hero' && selected === null;
    const infoId = `${ids}-${o.key}`;
    const box = {
      'data-create-option': o.key,
      ...(isOpen ? { 'data-info-open': '' } : {}),
      ...(isSelected ? { 'data-selected': '' } : {}),
      ...(pressed === o.key ? { 'data-pressed': '' } : {}),
      ...(solid ? { 'data-solid': '' } : {}),
    };
    const pickProps = {
      type: 'button' as const,
      'aria-label': o.title,
      'aria-pressed': isSelected,
      'aria-describedby': infoId,
      [`data-create-${o.key}`]: '',
      onClick: () => pick(o.key),
      onPointerDown: () => setPressed(o.key),
      onPointerUp: () => setPressed(null),
      onPointerLeave: () => setPressed(null),
      onPointerCancel: () => setPressed(null),
    };
    const iconTile = <span className={`w-10 h-10 shrink-0 rounded-lg flex items-center justify-center ${solid ? 'bg-white/20 text-white' : 'bg-brand-soft text-brand-fg'}`}>{ICONS[o.key]}</span>;
    const infoButton = (
      <button
        type="button"
        aria-label={`About ${o.title}`}
        aria-expanded={isOpen}
        aria-controls={infoId}
        data-create-info={o.key}
        onClick={() => setInfoOpen(toggleInfo(infoOpen, o.key))}
        className={`w-11 h-11 shrink-0 rounded-full flex items-center justify-center transition-colors ${isOpen ? (solid ? 'bg-white text-brand' : 'bg-brand text-white') : (solid ? 'bg-white/15 text-white' : 'text-faint')}`}
      >
        <Info size={20} strokeWidth={2} aria-hidden="true" />
      </button>
    );
    const titleTone = solid ? 'text-white' : 'text-primary';
    const infoTone = solid ? 'text-white/90' : 'text-muted';

    if (o.shape === 'tile') {
      return (
        <div key={o.key} className="ea-create-opt h-[136px] max-[359px]:h-[172px]" {...box}>
          <button {...pickProps} className="absolute inset-0 rounded-[18px] text-left">
            <span className="ea-create-layer absolute inset-0 p-4 max-[359px]:p-3 flex flex-col" {...(isOpen ? {} : { 'data-on': '' })}>
              {iconTile}
              <span className={`mt-auto text-[15px] font-semibold leading-tight ${titleTone}`} data-create-title="">{o.title}</span>
            </span>
            <span className="ea-create-layer absolute inset-0 p-4 max-[359px]:p-3 flex flex-col" {...(isOpen ? { 'data-on': '' } : {})}>
              <span className={`min-h-10 flex items-center pr-10 text-sm max-[359px]:text-[13px] font-semibold leading-tight ${titleTone}`}>{o.title}</span>
              <span id={infoId} className={`mt-2 text-xs leading-snug ${infoTone}`} data-create-info-text="">{o.info}</span>
            </span>
          </button>
          <div className="absolute top-3 right-2 max-[359px]:top-2 max-[359px]:right-1">{infoButton}</div>
        </div>
      );
    }
    return (
      <div key={o.key} className="ea-create-opt h-[72px] flex items-center pr-2.5" {...box}>
        <button {...pickProps} className="flex-1 min-w-0 h-full flex items-center gap-3.5 pl-4 rounded-[18px] text-left">
          {iconTile}
          <span className="relative flex-1 min-w-0 h-full">
            <span className={`ea-create-layer absolute inset-0 flex items-center text-base font-semibold ${titleTone}`} {...(isOpen ? {} : { 'data-on': '' })} data-create-title="">{o.title}</span>
            <span id={infoId} className={`ea-create-layer absolute inset-0 flex items-center text-[13px] leading-snug ${infoTone}`} {...(isOpen ? { 'data-on': '' } : {})} data-create-info-text="">{o.info}</span>
          </span>
        </button>
        {infoButton}
      </div>
    );
  };

  const hero = CREATE_OPTIONS.filter((o) => o.shape === 'hero');
  const tiles = CREATE_OPTIONS.filter((o) => o.shape === 'tile');
  const rows = CREATE_OPTIONS.filter((o) => o.shape === 'row');

  return (
    <LargerWindow title="Create" onClose={onClose} windowKey="create" bare>
      <div className="px-4 pt-2.5 pb-6 flex flex-col gap-3">
        <div className="sm:hidden self-center w-9 h-[5px] rounded-full bg-border-strong" aria-hidden="true" />
        <div className="flex items-center justify-between pl-1">
          <h2 className="text-[22px] font-bold tracking-tight text-primary">Create</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="w-11 h-11 -mr-1 shrink-0 flex items-center justify-center rounded-full text-tertiary">
            <span className="w-9 h-9 rounded-full bg-surface-sunken flex items-center justify-center"><X size={16} strokeWidth={2.2} aria-hidden="true" /></span>
          </button>
        </div>
        <div className="flex flex-col gap-3" data-create-sheet="" data-create-step="root">
          {hero.map(option)}
          <div className="grid grid-cols-2 gap-3">{tiles.map(option)}</div>
          {rows.map(option)}
        </div>
      </div>
    </LargerWindow>
  );
}
