'use client';

import { AvatarImage } from '@/components/OptimizedImage';
import { tagRowLabel } from '@/lib/posts/composer-rules';
import { ChevronRightIcon, CloseIcon, PlusIcon } from '@/components/golf/scoring/icons';
import { GaugeIcon, PeopleIcon, PinIcon } from './icons';

/**
 * The composer's Details panel (Tom's General post spec, Nov 26 2026 — C5):
 * one panel of 56 px rows — an 18 px icon, the label filling the width, the
 * row's own control on the right. The rows are handed in, so a later row
 * (attach activity, location) joins without the panel changing.
 */
export function DetailsPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="ea-mech-panel min-w-0 rounded-2xl" data-compose-details="">
      {children}
    </div>
  );
}

/** One row of the panel. `first` drops the line above it. */
export function DetailRow({ icon, iconColour, first = false, hook, children }: {
  icon: React.ReactNode;
  iconColour: string;
  first?: boolean;
  hook: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex h-14 min-w-0 items-center gap-3 pl-3.5 pr-1.5"
      style={first ? undefined : { boxShadow: 'inset 0 1px 0 var(--mech-divider)' }}
      data-compose-row={hook}
    >
      <span aria-hidden="true" className="inline-flex shrink-0" style={{ color: iconColour }}>{icon}</span>
      {children}
    </div>
  );
}

export interface TaggedPerson {
  id: string;
  name: string;
  avatarUrl: string | null;
}

const initialsOf = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase() ?? '').join('');

/** How many faces the row draws before the label carries the rest ("+1"). */
const FACES = 3;

/** Row 1 — Tag people: first names as the label, the tagged faces (a tap on
 *  one removes that person), and the round plus key that opens the dialog. */
export function TagPeopleRow({ people, onAdd, onRemove, first = true }: {
  people: TaggedPerson[];
  onAdd: () => void;
  onRemove: (id: string) => void;
  first?: boolean;
}) {
  const tagged = people.length > 0;
  return (
    <DetailRow icon={<PeopleIcon size={18} />} iconColour="var(--mech-upload)" first={first} hook="people">
      <span className="min-w-0 flex-1 truncate text-sm font-semibold" style={{ color: tagged ? 'var(--mech-text)' : 'var(--mech-text-dim)' }} data-compose-people-label="">
        {tagRowLabel(people.map(p => p.name))}
      </span>
      {tagged && (
        <span className="flex shrink-0 items-center pl-1.5" data-compose-people="">
          {people.slice(0, FACES).map(person => (
            <button
              key={person.id}
              type="button"
              onClick={() => onRemove(person.id)}
              aria-label={`Remove ${person.name}`}
              className="ea-mech-btn -ml-1.5 inline-flex h-[30px] w-[30px] shrink-0 overflow-hidden rounded-full"
              style={{ boxShadow: '0 0 0 2px var(--mech-panel)' }}
            >
              <AvatarImage src={person.avatarUrl} alt="" size={30} fallbackInitials={initialsOf(person.name)} className="h-[30px] w-[30px] rounded-full" />
            </button>
          ))}
        </span>
      )}
      <button
        type="button"
        onClick={onAdd}
        aria-label="Tag people"
        className="ea-mech-btn inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
        data-compose-tag-people=""
      >
        <span aria-hidden="true" className="ea-mech-flatkey inline-flex h-8 w-8 items-center justify-center rounded-full">
          <PlusIcon size={16} />
        </span>
      </button>
    </DetailRow>
  );
}

/** A row whose label opens something and whose right side is a chevron
 *  (empty) or a remove key (set). */
function OpenRow({ icon, iconColour, hook, label, set, onOpen, onRemove, removeLabel, children }: {
  icon: React.ReactNode;
  iconColour: string;
  hook: string;
  label: string;
  set: boolean;
  onOpen: () => void;
  onRemove: () => void;
  removeLabel: string;
  children?: React.ReactNode;
}) {
  return (
    <DetailRow icon={icon} iconColour={iconColour} hook={hook}>
      <button
        type="button"
        onClick={onOpen}
        className="ea-mech-btn flex h-14 min-w-0 flex-1 items-center gap-2 text-left"
        data-compose-open={hook}
      >
        <span className="min-w-0 flex-1 truncate text-sm font-semibold" style={{ color: set ? 'var(--mech-text)' : 'var(--mech-text-dim)' }}>{label}</span>
        {children}
        {!set && (
          <span aria-hidden="true" className="inline-flex h-11 w-9 shrink-0 items-center justify-center text-[color:var(--mech-chevron)]">
            <ChevronRightIcon size={16} />
          </span>
        )}
      </button>
      {set && (
        <button type="button" onClick={onRemove} aria-label={removeLabel} className="ea-mech-btn inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[color:var(--mech-text-soft)]" data-compose-remove={hook}>
          <CloseIcon size={14} />
        </button>
      )}
    </DetailRow>
  );
}

/** Row 2 — Attach activity (C6): empty, a door to the picker; set, the
 *  sport and the activity's name, its headline number in the sport's colour
 *  in a recessed chip, and a key that removes it. */
export function AttachRow({ label, headline, colour, onOpen, onRemove }: {
  /** "Golf · Loch March" when set; null when nothing is attached. */
  label: string | null;
  headline: string | null;
  colour: string | null;
  onOpen: () => void;
  onRemove: () => void;
}) {
  return (
    <OpenRow icon={<GaugeIcon size={18} />} iconColour="var(--mech-gold-icon)" hook="activity" label={label ?? 'Attach activity'} set={label !== null} onOpen={onOpen} onRemove={onRemove} removeLabel="Remove the attached activity">
      {label !== null && headline !== null && (
        <span className="ea-mech-recess ea-mech-readout shrink-0 rounded-lg px-2 py-1 text-[13px]" style={{ color: colour ?? 'var(--mech-text)' }} data-compose-activity-chip="">
          {headline}
        </span>
      )}
    </OpenRow>
  );
}

/** Row 3 — Location: empty, a door to the search; set, the place's name and a key that removes it. */
export function LocationRow({ label, onOpen, onRemove }: { label: string | null; onOpen: () => void; onRemove: () => void }) {
  return <OpenRow icon={<PinIcon size={18} />} iconColour="var(--mech-media)" hook="location" label={label ?? 'Add location'} set={label !== null} onOpen={onOpen} onRemove={onRemove} removeLabel="Remove the location" />;
}
