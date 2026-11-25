'use client';

import { useId, useState } from 'react';
import FaIcon from '@/components/FaIcon';
import InfoToggle from '@/components/mech/InfoToggle';
import { AvatarImage } from '@/components/OptimizedImage';
import { getInitials } from '@/lib/formatters';
import type { QuickAddPerson } from '@/lib/golf/recent-partners';
import { faPlus } from '@/lib/icons/fa/plus';
import { faUserPlus } from '@/lib/icons/fa/user-plus';
import { faXmark } from '@/lib/icons/fa/xmark';

/**
 * Step 5 of the golf round: who else is playing. Skippable — a round is
 * never refused for being played alone, and the person composing is on the
 * scorecard already (the server adds the creator).
 *
 * Tom's part 2 spec (Nov 24 2026 — the mechanical dialect):
 *  - The step opens BLANK: nobody is listed until someone is added.
 *  - QUICK ADD: a row of pictures only — the people from the account's most
 *    recent rounds (`/api/golf/partners/recent`). A tap adds that person and
 *    takes them off the row; removing them brings them back. The row is
 *    absent when there is nobody to suggest.
 *  - Each added partner: picture, name, then "HCP" and the handicap index.
 *    A player without one shows nothing there — no dash, no zero.
 *  - "Add others" opens the Tag People dialog, as before.
 *  - The explanation sits behind the info button; nothing else explains.
 */
interface PlayersStepProps {
  alreadyPlayed: boolean;
  partners: readonly QuickAddPerson[];
  /** The formatted handicap index per player id; absent or null = none. */
  handicaps: Readonly<Record<string, string | null>>;
  /** Who the quick add row still offers (already without the added ones). */
  quickAdd: readonly QuickAddPerson[];
  onQuickAdd: (person: QuickAddPerson) => void;
  onRemove: (id: string) => void;
  onAddOthers: () => void;
}

const RING = 'inset 0 0 0 1px var(--mech-avatar-ring)';

export default function PlayersStep({ alreadyPlayed, partners, handicaps, quickAdd, onQuickAdd, onRemove, onAddOthers }: PlayersStepProps) {
  const [infoOpen, setInfoOpen] = useState(false);
  const infoId = useId();
  // The partners already here when the step opened do not animate in; one
  // added while it is open does.
  const [present] = useState(() => new Set(partners.map(p => p.id)));
  const heading = alreadyPlayed ? 'Round participants' : 'Playing partners';

  return (
    <div data-round-step="players" className="flex flex-col gap-2.5">
      <div>
        <div className="flex h-7 items-center justify-between">
          <h3 className="ea-mech-micro" data-round-players-heading="">{heading}</h3>
          <InfoToggle
            open={infoOpen}
            onToggle={() => setInfoOpen(o => !o)}
            label={`More information about ${heading}`}
            controls={infoId}
            className="-mr-2"
          />
        </div>
        {infoOpen && (
          <p id={infoId} className="ea-mech-panel mt-2 rounded-xl px-3.5 py-3 text-xs leading-4 text-[color:var(--mech-text-dim)]" data-round-players-info="">
            {alreadyPlayed
              ? 'You’re on the scorecard already — add playing partners if you weren’t alone.'
              : 'Playing solo — just go live. Add partners any time if someone joins you.'}
          </p>
        )}
      </div>

      {quickAdd.length > 0 && (
        <div data-round-quick-add="">
          <p className="ea-mech-micro mb-2">Quick add</p>
          {/* -mx / px: the row scrolls sideways to the screen's edge, and the
              badges (2 px outside each picture) are not clipped. */}
          <ul className="ea-mech-scroll -mx-4 flex gap-3.5 overflow-x-auto px-4 py-1 sm:-mx-5 sm:px-5" data-scroll-x="">
            {quickAdd.map(person => (
              <li key={person.id} className="shrink-0">
                <button
                  type="button"
                  onClick={() => onQuickAdd(person)}
                  aria-label={`Add ${person.name}`}
                  data-round-quick-add-person={person.id}
                  className="ea-mech-btn ea-mech-press relative block h-[48px] w-[48px] rounded-full"
                >
                  <AvatarImage src={person.avatar_url} alt="" size={48} fallbackInitials={getInitials(person.name)} />
                  <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-full" style={{ boxShadow: RING }} />
                  <span
                    aria-hidden="true"
                    className="absolute -bottom-0.5 -right-0.5 inline-flex h-[18px] w-[18px] items-center justify-center rounded-full text-[10px] text-white"
                    style={{ backgroundColor: 'var(--mech-accent)', boxShadow: '0 0 0 2px var(--mech-surface)' }}
                  >
                    <FaIcon icon={faPlus} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {partners.length > 0 && (
        <ul className="ea-mech-panel overflow-hidden rounded-2xl" data-round-partners="">
          {partners.map((partner, i) => {
            const handicap = handicaps[partner.id];
            return (
              <li
                key={partner.id}
                data-round-partner={partner.id}
                {...(present.has(partner.id) ? {} : { 'data-enter': '' })}
                className="ea-mech-partner flex min-h-14 items-center gap-3 pl-3"
                style={i > 0 ? { borderTop: '1px solid var(--mech-divider)' } : undefined}
              >
                <span className="relative block h-[36px] w-[36px] shrink-0 rounded-full">
                  <AvatarImage src={partner.avatar_url} alt="" size={36} fallbackInitials={getInitials(partner.name)} />
                  <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-full" style={{ boxShadow: RING }} />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[color:var(--mech-text)]">{partner.name}</span>
                {handicap ? (
                  <span className="flex shrink-0 items-baseline gap-1.5" data-round-partner-handicap="">
                    <span className="ea-mech-micro">HCP</span>
                    <span className="ea-mech-readout min-w-[30px] text-right text-[13px]">{handicap}</span>
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => onRemove(partner.id)}
                  aria-label={`Remove ${partner.name}`}
                  className="ea-mech-btn inline-flex h-11 w-11 shrink-0 items-center justify-center text-[14px] text-[color:var(--mech-text-soft)]"
                >
                  <FaIcon icon={faXmark} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <button
        type="button"
        onClick={onAddOthers}
        data-round-add-players=""
        className="ea-mech-panel ea-mech-btn flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold text-[color:var(--mech-text)]"
      >
        <FaIcon icon={faUserPlus} className="ea-mech-icon text-[18px]" />
        Add others
      </button>
    </div>
  );
}
