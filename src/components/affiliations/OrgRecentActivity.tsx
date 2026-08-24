'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import LazyImage from '@/components/LazyImage';
import { formatDisplayName, getInitials } from '@/lib/formatters';

// The org page's recent-activity section (connections PR D): light excerpt
// rows of members' already-public posts, linking into the feed. Renders
// nothing when there's nothing — additive, like every org section.

interface ActivityRow {
  id: string;
  created_at: string;
  textExcerpt: string | null;
  thumbUrl: string | null;
  author: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    full_name: string | null;
    avatar_url: string | null;
  };
}

interface OrgRecentActivityProps {
  side: 'league' | 'club';
  orgId: string;
}

export default function OrgRecentActivity({ side, orgId }: OrgRecentActivityProps) {
  const [activity, setActivity] = useState<ActivityRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const base = side === 'league' ? `/api/leagues/${orgId}/activity` : `/api/clubs/${orgId}/activity`;
        const response = await fetch(base);
        if (!response.ok || cancelled) return;
        const data = await response.json();
        if (!cancelled) setActivity(data.activity ?? []);
      } catch {
        /* additive section — a failed load renders nothing */
      }
    })();
    return () => { cancelled = true; };
  }, [side, orgId]);

  if (!activity || activity.length === 0) return null;

  return (
    <div className="mt-6 bg-surface rounded-xl shadow-sm border border-border p-4 sm:p-6">
      <h2 className="text-lg font-semibold text-primary mb-4">Recent activity</h2>
      <ul className="space-y-2">
        {activity.map(row => {
          const name = formatDisplayName(
            row.author.first_name, null, row.author.last_name, row.author.full_name
          );
          return (
            <li key={row.id}>
              <Link
                href={`/feed?post=${row.id}`}
                className="flex items-start gap-3 p-2 rounded-lg hover:bg-surface-muted transition-colors"
              >
                {row.author.avatar_url ? (
                  <LazyImage
                    src={row.author.avatar_url}
                    alt={name}
                    className="w-9 h-9 rounded-full object-cover shrink-0"
                  />
                ) : (
                  <div className="w-9 h-9 bg-gradient-to-br from-violet-500 to-violet-600 rounded-full flex items-center justify-center shrink-0">
                    <span className="text-white text-xs font-semibold">{getInitials(name)}</span>
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-primary">{name}</p>
                  {row.textExcerpt && (
                    <p className="text-sm text-secondary line-clamp-2">{row.textExcerpt}</p>
                  )}
                  <p className="text-xs text-muted mt-0.5">
                    {new Date(row.created_at).toLocaleDateString(undefined, {
                      month: 'short', day: 'numeric',
                    })}
                  </p>
                </div>
                {row.thumbUrl && (
                  <LazyImage
                    src={row.thumbUrl}
                    alt=""
                    className="w-12 h-12 rounded-lg object-cover shrink-0"
                  />
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
