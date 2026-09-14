'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { activeSportsSection, SPORTS_SECTIONS } from '@/lib/sports-nav';

/** The section switch under the header: plain links, the calendar's segmented style, full width on a phone. */
export default function SportsSubnav() {
  const active = activeSportsSection(usePathname());
  return (
    <nav aria-label="Sports sections" className="mb-6">
      <div className="flex rounded-lg border border-border-strong overflow-hidden w-full sm:w-fit">
        {SPORTS_SECTIONS.map(s => {
          const current = s.key === active;
          return (
            <Link
              key={s.key}
              href={s.path}
              aria-current={current ? 'page' : undefined}
              data-sports-section={s.key}
              className={`flex-1 sm:flex-none min-h-[44px] px-3 sm:px-5 inline-flex items-center justify-center gap-2 text-sm font-medium transition ${current ? 'bg-brand text-white' : 'bg-surface text-tertiary hover:text-brand-fg'}`}
            >
              <i className={`fas ${s.icon}`} aria-hidden="true"></i>
              <span>{s.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
