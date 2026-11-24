'use client';

import { useId, useState } from 'react';
import FaIcon from '@/components/FaIcon';
import KeySwitch from '@/components/mech/KeySwitch';
import InfoToggle from '@/components/mech/InfoToggle';
import { faFlagCheckered } from '@/lib/icons/fa/flag-checkered';
import { faTree } from '@/lib/icons/fa/tree';
import { faWarehouse } from '@/lib/icons/fa/warehouse';

/**
 * Step 1 of the golf round (Oct 28 2026): WHEN ("Playing now" goes live,
 * "Already played" logs a finished round) and WHERE (Outdoor / Indoor).
 * Both default as the one-page form did — Playing now, Outdoor (Tom: keep
 * today's defaults). The e2e idioms (`/already played/i`, `/outdoor/i`)
 * still find exactly these buttons.
 *
 * The look (Tom's visual spec, Nov 23 2026 — the mechanical dialect): two
 * key switches, one per question, 18 px apart. The sport is named in the
 * frame's sport row above, so the "Golf" heading is gone. The helper
 * sentence under the first pair moved behind an info button: a tap swaps
 * the switch for a panel of the SAME height (64 px), so nothing below
 * moves; a second tap brings the switch back. Playing now keeps its
 * broadcast dot in the live red — lit and pulsing while it is the pressed
 * key (`data-on`), dimmed when it is not.
 */
interface RoundTypeStepProps {
  alreadyPlayed: boolean;
  indoor: boolean;
  onAlreadyPlayed: (alreadyPlayed: boolean) => void;
  onIndoor: (indoor: boolean) => void;
  /** Whose round it is — the athlete a guardian composes for, else the person. */
  forName?: string | null;
}

type When = 'now' | 'played';
type Where = 'outdoor' | 'indoor';

const WHEN_OPTIONS = [
  {
    value: 'now' as When,
    label: 'Playing now',
    icon: (selected: boolean) => (
      <span
        data-live-dot=""
        {...(selected ? { 'data-on': '' } : {})}
        aria-hidden="true"
        className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${selected ? 'animate-pulse' : 'opacity-50'}`}
        style={{ backgroundColor: 'var(--mech-live)' }}
      />
    ),
  },
  {
    value: 'played' as When,
    label: 'Already played',
    icon: () => <FaIcon icon={faFlagCheckered} className="text-[18px]" />,
  },
] as const;

const WHERE_OPTIONS = [
  { value: 'outdoor' as Where, label: 'Outdoor', icon: () => <FaIcon icon={faTree} className="text-[18px]" /> },
  { value: 'indoor' as Where, label: 'Indoor', icon: () => <FaIcon icon={faWarehouse} className="text-[18px]" /> },
] as const;

export default function RoundTypeStep({ alreadyPlayed, indoor, onAlreadyPlayed, onIndoor, forName }: RoundTypeStepProps) {
  const [infoOpen, setInfoOpen] = useState(false);
  const whenId = useId();

  return (
    <div data-round-step="type">
      {forName && (
        <p className="mb-2.5 text-[13px] text-[color:var(--mech-text-soft)]">For {forName}</p>
      )}

      <div>
        <div className="flex items-center justify-between h-7 mb-2">
          <span className="ea-mech-micro">When is this round?</span>
          <InfoToggle
            open={infoOpen}
            onToggle={() => setInfoOpen(o => !o)}
            label="About when the round is"
            controls={whenId}
            className="-mr-2"
          />
        </div>
        {infoOpen ? (
          <div
            id={whenId}
            className="ea-mech-panel h-16 rounded-[15px] px-3.5 flex flex-col justify-center gap-1.5 text-xs leading-4 text-[color:var(--mech-text-dim)]"
            data-round-when-info=""
          >
            <p><span className="font-semibold text-[color:var(--mech-text)]">Playing now:</span> live scoring, hole by hole.</p>
            <p><span className="font-semibold text-[color:var(--mech-text)]">Already played:</span> log a finished round.</p>
          </div>
        ) : (
          <KeySwitch
            id={whenId}
            label="When is this round?"
            options={WHEN_OPTIONS}
            value={alreadyPlayed ? 'played' : 'now'}
            onChange={v => onAlreadyPlayed(v === 'played')}
          />
        )}
      </div>

      <div className="mt-[18px]">
        <div className="flex items-center h-7 mb-2">
          <span className="ea-mech-micro">Round type</span>
        </div>
        <KeySwitch
          label="Round type"
          options={WHERE_OPTIONS}
          value={indoor ? 'indoor' : 'outdoor'}
          onChange={v => onIndoor(v === 'indoor')}
        />
        {indoor && (
          <p className="mt-2 text-xs text-[color:var(--mech-text-soft)]">Indoor rounds skip the tee and the playing conditions.</p>
        )}
      </div>
    </div>
  );
}
