'use client';

import { useId, useState } from 'react';
import KeySwitch from '@/components/mech/KeySwitch';
import InfoToggle from '@/components/mech/InfoToggle';
import RangeSlider from '@/components/mech/RangeSlider';
import {
  GIMME_MAX,
  GIMME_MIN,
  PUTTING_LABEL,
  PUTTING_MODES,
  puttingInfoLine,
  type PuttingMode,
} from '@/lib/golf/putting-rule';

/**
 * The putting rule of an indoor round (Tom's indoor course spec, Nov 27
 * 2026 — C5): a three-way key switch (Putt out · Gimme · Auto 2) with its
 * info key, over a readout that never changes height — the mode's own
 * words, the gimme distance slider, or (info open) one line that explains
 * the mode in force. Green is this control's signal colour, apart from the
 * purple that means "selected" everywhere else. It owns no data.
 */
interface PuttingRuleProps {
  mode: PuttingMode;
  gimmeFeet: number;
  onMode: (mode: PuttingMode) => void;
  onGimmeFeet: (feet: number) => void;
  className?: string;
}

const OPTIONS = PUTTING_MODES.map(value => ({ value, label: PUTTING_LABEL[value] }));

function FlagIcon() {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[color:var(--mech-good)]">
      <path d="M6 21V3.5" />
      <path d="M6 4.5 18 8 6 12.5" fill="currentColor" />
    </svg>
  );
}

export default function PuttingRule({ mode, gimmeFeet, onMode, onGimmeFeet, className = '' }: PuttingRuleProps) {
  const [infoOpen, setInfoOpen] = useState(false);
  const readoutId = useId();

  return (
    <div className={`flex min-w-0 flex-col gap-2 ${className}`} data-putting-rule={mode}>
      <div className="flex h-[50px] min-w-0 items-center gap-1">
        <KeySwitch
          size="sm"
          light
          lampTone="good"
          label="Putting"
          options={OPTIONS}
          value={mode}
          onChange={onMode}
          className="min-w-0 flex-1"
          keyClassName="flex-1 basis-0 !gap-1.5 px-1"
        />
        <InfoToggle
          open={infoOpen}
          onToggle={() => setInfoOpen(o => !o)}
          label="About putting"
          controls={readoutId}
          className="-mr-2"
        />
      </div>

      <div
        id={readoutId}
        className="ea-mech-panel flex h-[52px] min-w-0 items-center gap-2.5 rounded-[14px] px-3"
        data-putting-readout={infoOpen ? 'info' : mode}
      >
        <FlagIcon />
        {infoOpen ? (
          <p className="min-w-0 flex-1 text-xs leading-4 text-[color:var(--mech-text-dim)]" data-putting-info="">
            {puttingInfoLine(mode, gimmeFeet)}
          </p>
        ) : mode === 'gimme' ? (
          <>
            <RangeSlider
              value={gimmeFeet}
              onChange={onGimmeFeet}
              min={GIMME_MIN}
              max={GIMME_MAX}
              label="Gimme distance in feet"
              valueText={`${gimmeFeet} ${gimmeFeet === 1 ? 'foot' : 'feet'}`}
              className="flex-1"
            />
            <span className="flex w-[50px] shrink-0 items-baseline justify-end gap-1" data-putting-feet="">
              <span className="ea-mech-readout text-lg leading-none !text-[color:var(--mech-good)]">{gimmeFeet}</span>
              <span className="ea-mech-micro">ft</span>
            </span>
          </>
        ) : mode === 'auto_2' ? (
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="ea-mech-micro truncate">On the green</span>
            <span className="ea-mech-readout text-base leading-none !text-[color:var(--mech-good)]">+2</span>
            <span className="ea-mech-micro">Putts</span>
          </span>
        ) : (
          <span className="ea-mech-micro truncate">Every putt counts</span>
        )}
      </div>
    </div>
  );
}
