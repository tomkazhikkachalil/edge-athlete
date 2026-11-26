'use client';

import { AvatarImage } from '@/components/OptimizedImage';
import { tagRowLabel } from '@/lib/posts/composer-rules';
import { PlusIcon } from '@/components/golf/scoring/icons';
import { PeopleIcon } from './icons';

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
