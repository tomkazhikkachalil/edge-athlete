'use client';

/**
 * Events program, phase 4 — the recorder's group switcher on the live page:
 * one pill per playing group of the round; the active one is the card
 * below. A player in a group sees it only when they are a named recorder
 * (or an organizer) and the round has more than one group.
 */
export default function GroupSwitcher({ groups, activeId, onPick }: { groups: Array<{ id: string; name: string | null; sequence: number }>; activeId: string | null; onPick: (id: string) => void }) {
  return (
    <div role="tablist" aria-label="Groups" className="flex gap-2 overflow-x-auto scrollbar-hide px-4 py-2 border-b border-border" data-group-switcher="">
      {groups.map(g => {
        const active = g.id === activeId;
        return (
          <button
            key={g.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onPick(g.id)}
            className={`shrink-0 px-3 min-h-[36px] rounded-full text-xs font-semibold border ${active ? 'border-brand bg-brand-soft text-brand-fg-strong' : 'border-border-strong text-secondary'}`}
            data-group-pill={g.id}
          >
            {g.name ?? `Group ${g.sequence}`}
          </button>
        );
      })}
    </div>
  );
}
