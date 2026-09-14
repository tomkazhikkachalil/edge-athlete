'use client';

import { EVENT_TAB_LABEL, type EventTab } from '@/lib/sport-events/tabs';

/** The ARIA tab strip (the SharedRoundFullCard shape): scrolls on a phone, every tab a 44px target. */
export default function EventTabs({ tabs, active, onChange }: { tabs: EventTab[]; active: EventTab; onChange: (t: EventTab) => void }) {
  return (
    <div className="border-b border-border-strong bg-surface rounded-t-lg relative">
      <div className="flex overflow-x-auto scrollbar-hide px-2 sm:px-4" role="tablist" aria-label="Event sections">
        {tabs.map(tab => {
          const selected = tab === active;
          return (
            <button
              key={tab}
              id={`event-tab-${tab}`}
              role="tab"
              aria-selected={selected}
              aria-controls={`event-panel-${tab}`}
              onClick={() => onChange(tab)}
              data-event-tab={tab}
              className={`px-4 py-3 min-h-[44px] font-bold text-sm border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                selected ? 'border-brand text-brand-fg-strong' : 'border-transparent text-tertiary hover:text-primary'
              }`}
            >
              {EVENT_TAB_LABEL[tab]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
