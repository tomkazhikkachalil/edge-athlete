'use client';

import { AnnouncementList, useAnnouncements } from './OrgAnnouncementsCard';

// The console's announcement history (N3): what was sent, when, and which
// ones went to the site. Re-reads when `refreshKey` changes (a send).

export default function AnnouncementHistory({
  plural,
  orgId,
  refreshKey,
}: {
  plural: 'clubs' | 'leagues';
  orgId: string;
  refreshKey: number;
}) {
  const items = useAnnouncements(plural, orgId, true, refreshKey);
  if (!items || items.length === 0) return null;
  return (
    <div className="pt-1" data-announcement-history={items.length}>
      <p className="text-xs font-medium text-secondary">Sent</p>
      <AnnouncementList items={items} compact />
    </div>
  );
}
