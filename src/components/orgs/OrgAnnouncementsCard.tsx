'use client';

import { useEffect, useState } from 'react';

// The announcement archive for MEMBERS (N3, program 10): every notice the
// org sent, newest first, from the session-gated /announcements read.
// Renders nothing for visitors, non-members, or an org that never
// announced. "On the site until …" marks the ones mirrored to the band.

export interface ArchivedAnnouncementItem {
  id: string;
  title: string;
  message: string;
  createdAt: string;
  siteNotice: boolean;
  noticeUntil: string | null;
}

export function useAnnouncements(plural: 'clubs' | 'leagues', orgId: string, enabled: boolean, refreshKey = 0) {
  const [items, setItems] = useState<ArchivedAnnouncementItem[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/${plural}/${encodeURIComponent(orgId)}/announcements`);
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as { announcements: ArchivedAnnouncementItem[] };
        if (!cancelled) setItems(body.announcements);
      } catch {
        /* the card simply stays hidden */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [plural, orgId, enabled, refreshKey]);
  return items;
}

export function AnnouncementList({ items, compact = false }: { items: ArchivedAnnouncementItem[]; compact?: boolean }) {
  return (
    <ul className="divide-y divide-border-subtle">
      {items.map(a => (
        <li key={a.id} className={compact ? 'py-1.5' : 'py-2'} data-announcement={a.id}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="text-sm font-medium text-primary">{a.title}</p>
            <span className="text-xs text-muted">
              {a.createdAt.slice(0, 10)}
              {a.siteNotice ? ` · on the site${a.noticeUntil ? ` until ${a.noticeUntil}` : ''}` : ''}
            </span>
          </div>
          {!compact && <p className="mt-1 text-sm text-secondary whitespace-pre-wrap">{a.message}</p>}
        </li>
      ))}
    </ul>
  );
}

export default function OrgAnnouncementsCard({
  side,
  orgId,
  isMember,
}: {
  side: 'club' | 'league';
  orgId: string;
  isMember: boolean;
}) {
  const items = useAnnouncements(side === 'club' ? 'clubs' : 'leagues', orgId, isMember);
  if (!isMember || !items || items.length === 0) return null;
  return (
    <section aria-label="Announcements" className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6" data-announcements={items.length}>
      <h2 className="text-lg font-semibold text-primary">Announcements</h2>
      <div className="mt-2">
        <AnnouncementList items={items} />
      </div>
    </section>
  );
}
