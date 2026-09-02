'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { formatPlace } from '@/lib/geo/regions';
import { SPORT_REGISTRY } from '@/lib/sports/SportRegistry';

// The "Clubs & Leagues" strip (org connections round) — mounted in the
// affiliation zone of the athlete pages and fed from the /u/ aggregate on
// the public page. Self-fetching by default (the TaggedTab precedent);
// renders NOTHING when the profile has no memberships.

export interface OrgMembership {
  kind: 'league' | 'club';
  id: string;
  name: string;
  role: string;
  /** Phase 7 C4: awaiting admin approval. */
  pending?: boolean;
  city: string | null;
  region: string | null;
  country: string | null;
  sport_key?: string | null;
}

interface OrgMembershipsStripProps {
  profileId: string;
  /** When the parent already holds the data (/u/'s aggregate), no fetch. */
  initialData?: OrgMembership[];
}

export default function OrgMembershipsStrip({ profileId, initialData }: OrgMembershipsStripProps) {
  const { user } = useAuth();
  const isSelf = user?.id === profileId;
  const [orgs, setOrgs] = useState<OrgMembership[] | null>(initialData ?? null);

  useEffect(() => {
    if (initialData) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/profile/${encodeURIComponent(profileId)}/organizations`);
        if (!response.ok || cancelled) return;
        const data = await response.json();
        if (!cancelled) setOrgs(data.organizations ?? []);
      } catch {
        /* the strip is additive — a failed load renders nothing */
      }
    })();
    return () => { cancelled = true; };
  }, [profileId, initialData]);

  if (!orgs || orgs.length === 0) return null;

  return (
    <div className="mt-3">
      <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-1.5">
        Clubs &amp; Leagues
      </p>
      <ul className="flex flex-wrap gap-2">
        {orgs.map(org => {
          const sport = org.sport_key
            ? SPORT_REGISTRY[org.sport_key as keyof typeof SPORT_REGISTRY]?.display_name ?? org.sport_key
            : null;
          const place = formatPlace({ city: org.city, region: org.region, country: org.country });
          const title = [sport, place].filter(Boolean).join(' · ');
          return (
            <li key={`${org.kind}-${org.id}`} className="flex items-center gap-1">
              <Link
                href={org.kind === 'league' ? `/league/${org.id}` : `/club/${org.id}`}
                title={title || undefined}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-surface-sunken text-sm text-secondary hover:border-violet-300 hover:text-primary transition-colors"
              >
                <i
                  className={`fas ${org.kind === 'league' ? 'fa-trophy' : 'fa-building'} text-brand-fg text-xs`}
                  aria-hidden="true"
                ></i>
                <span className="max-w-[10rem] truncate">{org.name}</span>
                {org.pending && (
                  <span className="text-[10px] font-semibold uppercase text-amber-700 dark:text-amber-300">Pending approval</span>
                )}
                {org.role !== 'member' && (
                  <span className="text-[10px] font-semibold text-brand-fg uppercase">{org.role}</span>
                )}
              </Link>
              {/* The console door — SIBLING link (never nested), and only on
                  the viewer's OWN strip: this strip renders on public
                  profiles, where the role badge is the profile's, not the
                  viewer's. */}
              {isSelf && org.role !== 'member' && (
                <Link
                  href={`/app/org/${org.kind}/${org.id}`}
                  className="text-[10px] font-semibold text-brand-fg uppercase px-1.5 py-1 rounded-md hover:bg-brand-soft transition-colors"
                >
                  Manage
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
