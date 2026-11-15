'use client';

/**
 * /u/[username]/sport/[sport] — the athlete's sport profile by handle
 * (Sprint 4 PR 3; route parity with /athlete/[id]/sport/[sport]). The
 * athlete and their sports come from the viewer-independent public bundle
 * the /u/ page reads; the numbers are the same SportProfile. A private
 * profile is not in that bundle: a signed-in viewer is sent to the /athlete
 * route, which knows whether they follow.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import AppHeader from '@/components/AppHeader';
import RouteLoading from '@/components/RouteLoading';
import SportProfile from '@/components/sport-profile/SportProfile';
import { useAuth } from '@/lib/auth';
import { formatDisplayName } from '@/lib/formatters';
import { landingSport } from '@/lib/sport-profile/view';
import type { SportSkillCard } from '@/lib/sports/server/types';

interface PublicProfile { id: string; first_name: string | null; middle_name?: string | null; last_name: string | null; full_name: string | null; avatar_url: string | null }
type Load =
  | { state: 'loading' }
  | { state: 'missing' }
  | { state: 'private'; profileId: string | null }
  | { state: 'ready'; profile: PublicProfile; cards: SportSkillCard[] };

export default function PublicSportProfilePage() {
  const { username, sport } = useParams<{ username: string; sport: string }>();
  const handle = decodeURIComponent(username ?? '').replace(/^@/, '');
  const { user, initialAuthCheckComplete } = useAuth();
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ state: 'loading' });

  useEffect(() => {
    if (!handle) return;
    let cancelled = false;
    fetch(`/api/public/profile?handle=${encodeURIComponent(handle)}`)
      .then(async r => ({ ok: r.ok, status: r.status, body: await r.json().catch(() => null) as { profile?: PublicProfile; skillCards?: SportSkillCard[]; isPrivate?: boolean; profileId?: string } | null }))
      .then(({ ok, status, body }) => {
        if (cancelled) return;
        if (ok && body?.profile) setLoad({ state: 'ready', profile: body.profile, cards: body.skillCards ?? [] });
        else if (status === 403 && body?.isPrivate) setLoad({ state: 'private', profileId: body.profileId ?? null });
        else setLoad({ state: 'missing' });
      })
      .catch(() => { if (!cancelled) setLoad({ state: 'missing' }); });
    return () => { cancelled = true; };
  }, [handle]);

  // A private profile: the /athlete route decides for a signed-in viewer (a follower is let in there).
  const privateId = load.state === 'private' ? load.profileId : null;
  useEffect(() => {
    if (privateId && initialAuthCheckComplete && user) router.replace(`/athlete/${privateId}/sport/${sport}${window.location.search}`);
  }, [privateId, initialAuthCheckComplete, user, sport, router]);

  const landing = load.state === 'ready' ? landingSport(load.cards, sport) : null;
  useEffect(() => {
    if (load.state === 'ready' && landing && landing !== sport) router.replace(`/u/${encodeURIComponent(handle)}/sport/${landing}`);
  }, [load.state, landing, sport, handle, router]);

  if (load.state === 'loading' || (load.state === 'private' && (!initialAuthCheckComplete || !!user))) return <RouteLoading message="Loading sport profile..." />;
  if (load.state !== 'ready' || !landing) {
    const title = load.state === 'private' ? 'Private profile' : load.state === 'missing' ? 'Profile not found' : 'No sports yet';
    const body = load.state === 'private' ? 'Log in to see this athlete\'s profile if you follow them.' : load.state === 'missing' ? `The profile @${handle} does not exist.` : 'This athlete has not added a sport.';
    return (
      <div className="min-h-screen bg-canvas">
        <AppHeader showSearch={false} />
        <div className="mx-auto max-w-xl px-4 py-16 text-center">
          <h1 className="mb-2 text-2xl font-bold text-primary">{title}</h1>
          <p className="mb-6 text-secondary">{body}</p>
          <Link href={load.state === 'ready' ? `/u/${encodeURIComponent(handle)}` : '/'} className="ea-cta inline-flex">{load.state === 'ready' ? 'Back to the profile' : 'Go home'}</Link>
        </div>
      </div>
    );
  }
  const p = load.profile;
  return (
    <div className="min-h-screen bg-canvas pb-24 lg:pb-8">
      <AppHeader showSearch={true} />
      <SportProfile
        profileId={p.id}
        name={formatDisplayName(p.first_name, p.middle_name, p.last_name, p.full_name) || 'Athlete'}
        avatarUrl={p.avatar_url}
        cards={load.cards}
        sport={landing}
        profilePath={`/u/${encodeURIComponent(handle)}`}
        sportPath={key => `/u/${encodeURIComponent(handle)}/sport/${key}`}
      />
    </div>
  );
}
