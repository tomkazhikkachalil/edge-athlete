'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  Activity,
  CalendarDays,
  Flag,
  Image as ImageIcon,
  Landmark,
  Link2,
  Megaphone,
  Newspaper,
  Trophy,
  Users,
  type LucideIcon,
} from 'lucide-react';
import BubbleCard from '@/components/bubbles/BubbleCard';
import LargerWindow from '@/components/bubbles/LargerWindow';
import { AvatarImage } from '@/components/OptimizedImage';
import AffiliationSection from '@/components/affiliations/AffiliationSection';
import ParentLeaguesSection from '@/components/affiliations/ParentLeaguesSection';
import OrgUpcomingEvents from '@/components/affiliations/OrgUpcomingEvents';
import OrgRecentActivity from '@/components/affiliations/OrgRecentActivity';
import OrgStandings from '@/components/orgs/OrgStandings';
import OrgAnnouncementsCard, { useAnnouncements } from '@/components/orgs/OrgAnnouncementsCard';
import OrgNewsCard from '@/components/orgs/OrgNewsCard';
import GolfYourWeek from '@/components/orgs/GolfYourWeek';
import OrgVenues from '@/components/orgs/OrgVenues';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import { useAuth } from '@/lib/auth';
import OrgMembersList from './OrgMembersList';
import { pickPhotos, PhotosEmptyFace, PhotosFace, PhotosWindow } from './OrgPhotos';
import OrgMemberPostsGrid from './OrgMemberPostsGrid';
import { SIDE_COPY } from './side-copy';
import type { OrgPageController } from './useOrgPage';
import type { MemberRow, OrgSide } from './types';

// The glance grid — Org Pages R3 (Sep 8 2026), the Vitals principle applied
// to the org page: every dense section lives behind a tappable bubble that
// shows ONE big number and a sub-line; the bubble's "larger window" hosts
// the existing section component UNCHANGED (with `bare`, so it brings no
// card chrome), its <h2>, roles and testids intact — the e2e contracts
// hold, one tap deeper. The faces read the SAME endpoints the sections
// read (the load-time request count is what it was: sections now fetch
// only when their window opens); a window's mutations refresh the face on
// close. Zeros render honestly for managers (with the console as the
// add-affordance); a non-manager's zero bubble is omitted, as the sections
// rendered null before. Deep link: ?window=<key> opens that window.

export type OrgWindowKey =
  | 'members'
  | 'week'
  | 'standings'
  | 'events'
  | 'news'
  | 'announcements'
  | 'courses'
  | 'activity'
  | 'affiliations'
  | 'photos';

const WINDOW_KEYS: OrgWindowKey[] = [
  'members', 'week', 'standings', 'events', 'news', 'announcements', 'courses', 'activity', 'affiliations', 'photos',
];

/** One read per face — the section's own endpoint, the section's own
 *  swallow-on-failure. `enabled` false = the read never fires. */
function useOrgRead<T>(url: string | null, pick: (body: unknown) => T, enabled = true, reloadKey = 0): T | null {
  const [value, setValue] = useState<T | null>(null);
  useEffect(() => {
    if (!enabled || !url) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(url);
        if (!response.ok || cancelled) return;
        const body = await response.json();
        if (!cancelled) setValue(pick(body));
      } catch {
        /* additive — a failed read shows nothing */
      }
    })();
    return () => { cancelled = true; };
    // pick is a stable module-level function at every call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, enabled, reloadKey]);
  return value;
}

interface StandingsRead {
  count: number;
  lead: string | null;
  sub: string | null;
  mine: { rank: number; of: number } | null;
}
interface EventRead { count: number; day: string | null; month: string | null; title: string | null }
interface NewsRead { count: number; newest: string | null }
interface VenuesRead { count: number; first: string | null; courses: boolean }
interface ActivityRead { count: number; last: string | null }
interface AffRead { count: number; first: string | null; manager: boolean }
interface WeekRead { count: number; big: string | null; sub: string | null; season: string | null; rank: number | null }

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

const pickStandings = (body: unknown): StandingsRead => {
  const comps = ((body as { competitions?: Array<{ name: string; season_label: string | null; rows: Array<{ rank: number; entrant_name: string }>; golf?: unknown }> }).competitions ?? [])
    .filter(c => c.rows.length > 0 || c.golf);
  const first = comps[0];
  const leader = first?.rows[0];
  return {
    count: comps.length,
    lead: leader?.entrant_name ?? null,
    sub: first ? `${first.name}${first.season_label ? ` · ${first.season_label}` : ''}` : null,
    mine: null,
  };
};
const pickEvents = (body: unknown): EventRead => {
  const events = (body as { events?: Array<{ title: string; starts_at: string }> }).events ?? [];
  const next = events[0];
  const start = next ? new Date(next.starts_at) : null;
  return {
    count: events.length,
    day: start ? String(start.getDate()) : null,
    month: start ? start.toLocaleDateString(undefined, { month: 'short' }) : null,
    title: next?.title ?? null,
  };
};
const pickNews = (body: unknown): NewsRead => {
  const posts = (body as { posts?: Array<{ title: string }> }).posts ?? [];
  return { count: posts.length, newest: posts[0]?.title ?? null };
};
const pickVenues = (body: unknown): VenuesRead => {
  const venues = (body as { venues?: Array<{ name: string; courses: unknown[] }> }).venues ?? [];
  const courses = venues.some(v => v.courses.length > 0);
  return { count: courses ? venues.reduce((n, v) => n + v.courses.length, 0) : venues.length, first: venues[0]?.name ?? null, courses };
};
const pickActivity = (body: unknown): ActivityRead => {
  const rows = (body as { activity?: Array<{ author: { first_name: string | null; last_name: string | null; full_name: string | null } }> }).activity ?? [];
  const a = rows[0]?.author;
  return { count: rows.length, last: a ? formatDisplayName(a.first_name, null, a.last_name, a.full_name) : null };
};
const pickAff = (body: unknown): AffRead => {
  const d = body as { active?: Array<{ org?: { name?: string } | null }>; viewerIsManager?: boolean };
  return { count: d.active?.length ?? 0, first: d.active?.[0]?.org?.name ?? null, manager: !!d.viewerIsManager };
};
const pickWeek = (body: unknown): WeekRead => {
  const entries = (body as { entries?: Array<{ competitionName: string; week: { round: string | null } | null; result: { gross: number | null; net: number | null } | null; standing: { rank: number; of: number } | null }> }).entries ?? [];
  const e = entries[0];
  if (!e) return { count: 0, big: null, sub: null, season: null, rank: null };
  // The big number: the gross posted this week, else the season place.
  const gross = e.result?.gross;
  const big = gross !== null && gross !== undefined ? String(gross) : e.standing ? ordinal(e.standing.rank) : '—';
  return {
    count: entries.length,
    big,
    sub: `${e.competitionName}${e.week?.round ? ` · ${e.week.round}` : ''}`,
    // The same sentence GolfYourWeek prints (an e2e contract: data-standing).
    season: e.standing ? `Season: ${ordinal(e.standing.rank)} of ${e.standing.of}` : null,
    rank: e.standing?.rank ?? null,
  };
};

/** The big number + its quiet sub-line — one idiom for every face. */
function Face({ big, sub, children }: { big: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div>
      <div className="text-2xl sm:text-3xl font-bold text-primary tabular-nums leading-none truncate">{big}</div>
      {sub && <div className="mt-1.5 text-xs text-muted truncate">{sub}</div>}
      {children}
    </div>
  );
}

interface OrgGlanceGridProps {
  side: OrgSide;
  orgId: string;
  isMember: boolean;
  canManage: boolean;
  isOwner: boolean;
  standingsScope: 'public' | 'mine';
  members: MemberRow[];
  memberCount: number;
  viewerId: string | undefined;
  actions: OrgPageController['actions'];
  dialogs: OrgPageController['dialogs'];
}

export default function OrgGlanceGrid({
  side,
  orgId,
  isMember,
  canManage,
  isOwner,
  standingsScope,
  members,
  memberCount,
  viewerId,
  actions,
  dialogs,
}: OrgGlanceGridProps) {
  const copy = SIDE_COPY[side];
  const plural = copy.plural;
  const base = `/api/${plural}/${encodeURIComponent(orgId)}`;
  const consolePath = `/app/org/${side}/${orgId}`;
  const { user, initialAuthCheckComplete } = useAuth();
  const [open, setOpen] = useState<OrgWindowKey | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Deep link (?window=…) read once on mount — window.location rather than
  // useSearchParams, which would force a Suspense boundary on the route.
  useEffect(() => {
    try {
      const key = new URLSearchParams(window.location.search).get('window');
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the URL is an external input read once after mount (SSR has no window; a lazy initializer would hydrate-mismatch)
      if (key && (WINDOW_KEYS as string[]).includes(key)) setOpen(key as OrgWindowKey);
    } catch {
      /* no window (SSR) or malformed search — no deep link */
    }
  }, []);

  const signedIn = initialAuthCheckComplete && !!user;
  const week = useOrgRead(`${base}/golf/mine`, pickWeek, signedIn && isMember, reloadKey);
  const standings = useOrgRead(
    standingsScope === 'mine' ? `${base}/standings/mine` : `${base}/standings`,
    pickStandings,
    true,
    reloadKey
  );
  const events = useOrgRead(`${base}/events`, pickEvents, true, reloadKey);
  const news = useOrgRead(`${base}/news/mine`, pickNews, isMember, reloadKey);
  const announcements = useAnnouncements(plural, orgId, isMember, reloadKey);
  const venues = useOrgRead(`${base}/venues`, pickVenues, true, reloadKey);
  const activity = useOrgRead(`${base}/activity`, pickActivity, true, reloadKey);
  const affiliations = useOrgRead(
    side === 'league' ? `${base}/clubs` : `${base}/leagues`,
    pickAff,
    true,
    reloadKey
  );
  const chain = useOrgRead(side === 'league' ? `${base}/parents` : null, pickAff, side === 'league', reloadKey);
  // R4: the gallery — a public org's for everyone, a private org's for
  // members (the route decides; a 403 reads as nothing here).
  const photos = useOrgRead(`${base}/gallery`, pickPhotos, true, reloadKey);

  // A window's mutations (roles, roster, affiliations) change the faces —
  // refetch them when it closes, the same refetch-on-success discipline.
  const close = useCallback(() => {
    setOpen(null);
    setReloadKey(k => k + 1);
  }, []);

  const emptyLink = (label: string, hash?: string) =>
    canManage ? (
      <Link href={`${consolePath}${hash ?? ''}`} className="mt-1.5 inline-block text-xs font-medium text-brand-fg hover:text-brand-fg-strong">
        {label}
      </Link>
    ) : null;

  // Show rule: a face with content shows to everyone the section showed to;
  // a zero face shows to managers only (honest zero + the add-affordance).
  const show = (count: number | null | undefined, memberOnly = false) =>
    (!memberOnly || isMember) && ((count ?? 0) > 0 || canManage);

  type Bubble = { key: OrgWindowKey; icon: LucideIcon; label: string; span: 'sm' | 'md' | 'lg'; face: ReactNode; open: boolean };
  const bubbles: Bubble[] = [];

  bubbles.push({
    key: 'members', icon: Users, label: 'Members', span: 'sm', open: true,
    face: (
      <Face big={memberCount} sub={memberCount === 1 ? 'member' : 'members'}>
        {members.length > 0 && (
          <div className="mt-2 flex -space-x-2">
            {members.slice(0, 4).map(m => {
              const name = m.profile
                ? formatDisplayName(m.profile.first_name, null, m.profile.last_name, m.profile.full_name)
                : 'Member';
              return (
                <span key={m.profile_id} className="rounded-full ring-2 ring-surface">
                  <AvatarImage src={m.profile?.avatar_url ?? null} alt="" size={24} fallbackInitials={getInitials(name)} />
                </span>
              );
            })}
          </div>
        )}
      </Face>
    ),
  });

  if (signedIn && isMember && week && week.count > 0) {
    bubbles.push({
      key: 'week', icon: Flag, label: 'Your week', span: 'md', open: true,
      face: (
        <Face big={week.big} sub={week.sub}>
          <p className="mt-1 text-xs text-secondary">
            This week
            {week.season && (
              <span className="text-muted" data-standing={week.rank ?? undefined}>{` · ${week.season}`}</span>
            )}
          </p>
        </Face>
      ),
    });
  }

  if (standings && show(standings.count)) {
    bubbles.push({
      key: 'standings', icon: Trophy, label: 'Standings', span: 'md', open: standings.count > 0,
      face: standings.count > 0 ? (
        <Face big={standings.lead ?? '—'} sub={standings.sub ?? undefined}>
          <p className="mt-1 text-xs text-secondary">{standings.count === 1 ? 'Leader' : `Leader · ${standings.count} competitions`}</p>
        </Face>
      ) : (
        <Face big={0} sub="competitions">{emptyLink('Set up a competition →', '#competitions')}</Face>
      ),
    });
  }

  if (events && show(events.count)) {
    bubbles.push({
      key: 'events', icon: CalendarDays, label: 'Events', span: 'sm', open: events.count > 0,
      face: events.count > 0 ? (
        <Face big={<>{events.day}<span className="ml-1 text-base font-semibold text-tertiary">{events.month}</span></>} sub={events.title ?? undefined}>
          <p className="mt-1 text-xs text-secondary">{events.count === 1 ? '1 upcoming' : `${events.count} upcoming`}</p>
        </Face>
      ) : (
        <Face big={0} sub="upcoming">{emptyLink('Add an event →', '#competitions')}</Face>
      ),
    });
  }

  if (isMember && news && show(news.count, true)) {
    bubbles.push({
      key: 'news', icon: Newspaper, label: side === 'league' ? 'League news' : 'Club news', span: 'sm', open: news.count > 0,
      face: (
        <div data-org-news-count={news.count}>
          {news.count > 0 ? (
            <Face big={news.count} sub={news.newest ?? undefined} />
          ) : (
            <Face big={0} sub="posts">{emptyLink('Post news →', '#website')}</Face>
          )}
        </div>
      ),
    });
  }

  if (isMember && announcements && show(announcements.length, true)) {
    bubbles.push({
      key: 'announcements', icon: Megaphone, label: 'Announcements', span: 'sm', open: announcements.length > 0,
      face: (
        <div data-announcements-count={announcements.length}>
          {announcements.length > 0 ? (
            <Face big={announcements.length} sub={announcements[0]?.title} />
          ) : (
            <Face big={0} sub="notices">{emptyLink('Announce →', '#roster')}</Face>
          )}
        </div>
      ),
    });
  }

  if (venues && show(venues.count)) {
    bubbles.push({
      key: 'courses', icon: Landmark, label: venues.courses ? 'Courses' : 'Venues', span: 'sm', open: venues.count > 0,
      face: venues.count > 0 ? (
        <Face big={venues.count} sub={venues.first ?? undefined} />
      ) : (
        <Face big={0} sub="venues">{emptyLink('Add a venue →', '#venues')}</Face>
      ),
    });
  }

  if (activity && activity.count > 0) {
    bubbles.push({
      key: 'activity', icon: Activity, label: 'Recent activity', span: 'sm', open: true,
      face: <Face big={activity.count} sub={activity.last ? `Latest · ${activity.last}` : undefined} />,
    });
  }

  if (photos && show(photos.count)) {
    bubbles.push({
      key: 'photos', icon: ImageIcon, label: 'Photos', span: 'md', open: photos.count > 0,
      face: photos.count > 0
        ? <PhotosFace read={photos} />
        : <PhotosEmptyFace read={photos} canManage={canManage} consolePath={consolePath} />,
    });
  }

  const affCount = (affiliations?.count ?? 0) + (chain?.count ?? 0);
  const affManager = !!affiliations?.manager || !!chain?.manager;
  if (affiliations && (affCount > 0 || affManager)) {
    bubbles.push({
      key: 'affiliations', icon: side === 'league' ? Link2 : Landmark,
      label: side === 'league' ? 'Affiliated clubs' : 'Leagues', span: 'sm', open: true,
      face: affCount > 0
        ? <Face big={affCount} sub={affiliations.first ?? chain?.first ?? undefined} />
        : <Face big={0} sub="affiliations"><p className="mt-1.5 text-xs text-muted">Invite one inside →</p></Face>,
    });
  }

  const windowFor = (key: OrgWindowKey): ReactNode => {
    switch (key) {
      case 'members':
        return (
          <OrgMembersList
            members={members}
            memberCount={memberCount}
            canManage={canManage}
            isOwner={isOwner}
            viewerId={viewerId}
            actions={actions}
            dialogs={dialogs}
            bare
          />
        );
      case 'week':
        return <GolfYourWeek side={side} orgId={orgId} bare />;
      case 'standings':
        return <OrgStandings side={side} orgId={orgId} scope={standingsScope} bare />;
      case 'events':
        return <OrgUpcomingEvents side={side} orgId={orgId} bare />;
      case 'news':
        return <OrgNewsCard side={side} orgId={orgId} isMember={isMember} bare />;
      case 'announcements':
        return <OrgAnnouncementsCard side={side} orgId={orgId} isMember={isMember} bare />;
      case 'courses':
        return <OrgVenues side={side} orgId={orgId} bare />;
      case 'activity':
        return <OrgRecentActivity side={side} orgId={orgId} bare />;
      case 'photos':
        return photos ? <PhotosWindow read={photos} /> : null;
      case 'affiliations':
        return (
          <div className="space-y-6">
            <AffiliationSection side={side} orgId={orgId} bare />
            {side === 'league' && <ParentLeaguesSection leagueId={orgId} bare />}
          </div>
        );
    }
  };

  const openBubble = bubbles.find(b => b.key === open) ?? null;

  return (
    <>
      {/* row-dense: a `md` bubble after a `sm` one leaves a hole on the two-column
          phone grid; dense flow lets the next small face fill it (DOM order —
          and the tab order — is unchanged). */}
      <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 grid-flow-row-dense gap-3 sm:gap-4" data-org-glance="">
        {bubbles.map((b, i) => (
          <div key={b.key} className={`contents`} data-org-bubble-wrap={b.key}>
            <BubbleCardWithHook
              bubble={b}
              staggerIndex={i}
              onOpen={b.open ? () => setOpen(b.key) : undefined}
            />
          </div>
        ))}
        {/* R5: the members' posts wall — a static lg bubble whose tiles are
            the buttons; it owns its read, its window and its detail modal. */}
        <OrgMemberPostsGrid side={side} orgId={orgId} viewerId={viewerId} canManage={canManage} staggerIndex={bubbles.length} />
      </div>
      {openBubble && (
        <LargerWindow title={openBubble.label} windowKey={openBubble.key} onClose={close} hostsOwnHeading>
          {windowFor(openBubble.key)}
        </LargerWindow>
      )}
    </>
  );
}

/** BubbleCard is the whole button; the e2e hook (data-org-bubble) sits on
 *  the card itself, so the wrapper above is `contents` and this passes the
 *  attribute through the card's root. */
function BubbleCardWithHook({
  bubble,
  staggerIndex,
  onOpen,
}: {
  bubble: { key: OrgWindowKey; icon: LucideIcon; label: string; span: 'sm' | 'md' | 'lg'; face: ReactNode };
  staggerIndex: number;
  onOpen?: () => void;
}) {
  return (
    <BubbleCard
      span={bubble.span}
      icon={bubble.icon}
      label={bubble.label}
      onOpen={onOpen}
      staggerIndex={staggerIndex}
      rootAttrs={{ 'data-org-bubble': bubble.key }}
    >
      {bubble.face}
    </BubbleCard>
  );
}
