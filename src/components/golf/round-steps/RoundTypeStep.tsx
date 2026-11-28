'use client';

import { useId, useState } from 'react';
import FaIcon from '@/components/FaIcon';
import KeySwitch from '@/components/mech/KeySwitch';
import InfoToggle from '@/components/mech/InfoToggle';
import { faFlagCheckered } from '@/lib/icons/fa/flag-checkered';
import { faTree } from '@/lib/icons/fa/tree';
import { faWarehouse } from '@/lib/icons/fa/warehouse';

/**
 * Step 1 of the golf round (Oct 28 2026): WHEN ("Live" goes live,
 * "Already played" logs a finished round) and WHERE (Outdoor / Indoor).
 * Both default as the one-page form did — Live, Outdoor (Tom: keep
 * today's defaults). Nov 27 2026 (Tom): the WHEN keys are back, named Live
 * and Already played; the played steps are built next (round-steps.ts).
 *
 * The look (Tom's visual spec, Nov 23 2026 — the mechanical dialect): two
 * key switches, one per question, 18 px apart. The sport is named in the
 * frame's sport row above, so the "Golf" heading is gone. The helper
 * sentence under the first pair moved behind an info button: a tap swaps
 * the switch for a panel of the SAME height (64 px), so nothing below
 * moves; a second tap brings the switch back. Live keeps its
 * broadcast dot in the live red — lit and pulsing while it is the pressed
 * key (`data-on`), dimmed when it is not.
 */
interface RoundTypeStepProps {
  alreadyPlayed: boolean;
  indoor: boolean;
  onAlreadyPlayed: (alreadyPlayed: boolean) => void;
  onIndoor: (indoor: boolean) => void;
  /** The WHEN question is asked (round-steps.ts ALREADY_PLAYED_OFFERED).
   *  While it is not, the step asks only Outdoor / Indoor and the round is
   *  live. */
  offerAlreadyPlayed?: boolean;
  /** Whose round it is — the athlete a guardian composes for, else the person. */
  forName?: string | null;
}

type When = 'now' | 'played';
type Where = 'outdoor' | 'indoor';

const WHEN_OPTIONS = [
  {
    value: 'now' as When,
    label: 'Live',
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

export default function RoundTypeStep({ alreadyPlayed, indoor, onAlreadyPlayed, onIndoor, forName, offerAlreadyPlayed = true }: RoundTypeStepProps) {
  const [infoOpen, setInfoOpen] = useState(false);
  const whenId = useId();

  return (
    <div data-round-step="type">
      {forName && (
        <p className="mb-2.5 text-[13px] text-[color:var(--mech-text-soft)]">For {forName}</p>
      )}

      {offerAlreadyPlayed && (
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
            <p><span className="font-semibold text-[color:var(--mech-text)]">Live:</span> score it hole by hole as you play.</p>
            <p><span className="font-semibold text-[color:var(--mech-text)]">Already played:</span> log a finished round.</p>
          </div>
        ) : (
          <KeySwitch
            id={whenId}
            label="When is this round?"
            options={WHEN_OPTIONS}
            value={alreadyPlayed ? 'played' : 'now'}
            // "Already played" beside its flag needs 109 px; a 320 px screen
            // gives the key 102 (92 with enlarged text). Below 360 px these
            // two keys set a smaller label and gap so the words are never cut.
            keyClassName="max-[359px]:text-[13px] max-[359px]:gap-1"
            onChange={v => onAlreadyPlayed(v === 'played')}
          />
        )}
      </div>
      )}

      <div className={offerAlreadyPlayed ? 'mt-[18px]' : ''}>
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
          <p className="mt-2 text-xs text-[color:var(--mech-text-soft)]">Indoor rounds skip the playing conditions.</p>
        )}
      </div>
    </div>
  );
}
