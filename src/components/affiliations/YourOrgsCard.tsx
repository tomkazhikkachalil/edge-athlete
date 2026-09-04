'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { SPORT_REGISTRY } from '@/lib/sports/SportRegistry';
import type { OrgMembership } from '@/components/affiliations/OrgMembershipsStrip';

// The feed sidebar's org card — replaces the long-standing "Your Club /
// coming soon" placeholder with the viewer's real memberships. Empty state
// keeps the card useful: doors to the two Start pages.

export default function YourOrgsCard() {
  const { user } = useAuth();
  const [orgs, setOrgs] = useState<OrgMembership[] | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/profile/${encodeURIComponent(user.id)}/organizations`);
        if (!response.ok || cancelled) return;
        const data = await response.json();
        if (!cancelled) setOrgs(data.organizations ?? []);
      } catch {
        /* additive card — a failed load shows the empty state */
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  return (
    <div id="your-orgs" className="bg-surface rounded-lg shadow-sm border border-border p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-primary">Your Clubs &amp; Leagues</h3>
      </div>
      {orgs && orgs.length > 0 ? (
        <ul className="space-y-1">
          {orgs.slice(0, 5).map(org => {
            const sport = org.sport_key
              ? SPORT_REGISTRY[org.sport_key as keyof typeof SPORT_REGISTRY]?.display_name ?? org.sport_key
              : null;
            return (
              // Two SIBLING links per row (never nested anchors): the org
              // page, and — for owners/managers — the console (phase 1).
              <li key={`${org.kind}-${org.id}`} className="flex items-center gap-1 min-w-0">
                <Link
                  href={org.kind === 'league' ? `/league/${org.id}` : `/club/${org.id}`}
                  className="flex items-center gap-2 p-2 rounded-lg hover:bg-surface-muted transition-colors min-w-0 flex-1"
                >
                  <i
                    className={`fas ${org.kind === 'league' ? 'fa-trophy' : 'fa-building'} text-brand-fg text-sm shrink-0`}
                    aria-hidden="true"
                  ></i>
                  <span className="text-sm font-medium text-primary truncate">{org.name}</span>
                  {org.pending && (
                    <span className="text-[10px] font-semibold uppercase text-amber-700 dark:text-amber-300 shrink-0">
                      Pending approval
                    </span>
                  )}
                  {org.role === 'member' && sport && (
                    <span className="ml-auto text-xs text-muted shrink-0">{sport}</span>
                  )}
                </Link>
                {org.role !== 'member' && (
                  <Link
                    href={`/app/org/${org.kind}/${org.id}`}
                    className="text-[10px] font-semibold text-brand-fg uppercase shrink-0 px-2 py-1.5 rounded-md hover:bg-brand-soft transition-colors"
                  >
                    Manage
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="flex flex-col items-center justify-center py-6 text-center">
          <div className="w-10 h-10 bg-green-50 dark:bg-green-950/40 rounded-full flex items-center justify-center mb-3">
            <i className="fas fa-flag text-green-400 text-lg" aria-hidden="true"></i>
          </div>
          <p className="text-sm font-medium text-secondary mb-1">No clubs or leagues yet</p>
          <p className="text-xs text-faint mb-3">Join one from Explore or search — or start your own.</p>
          <div className="flex gap-2">
            <Link
              href="/league/start"
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
            >
              Start a league
            </Link>
            <Link
              href="/club/start"
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
            >
              Start a club
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
