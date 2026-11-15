'use client';

/**
 * /athlete/[id]/sport/[sport] — the athlete's sport profile for a signed-in
 * viewer (Sprint 4 PR 3). The athlete's own id stays here (no redirect to
 * /athlete): it is the same page for everyone. A thin shell: who the athlete
 * is and their sports in their own order, then SportProfile.
 */
import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import AppHeader from '@/components/AppHeader';
import PrivateProfileView from '@/components/PrivateProfileView';
import RouteLoading from '@/components/RouteLoading';
import SportProfile from '@/components/sport-profile/SportProfile';
import UnclaimedBanner from '@/components/sport-profile/UnclaimedBanner';
import type { UnclaimedView } from '@/lib/sport-profile/unclaimed-server';
import { useAuth } from '@/lib/auth';
import { fetchJson, httpStatus, readCached } from '@/lib/net/query-cache';
import { formatDisplayName } from '@/lib/formatters';
import { landingSport } from '@/lib/sport-profile/view';
import type { SportSkillCard } from '@/lib/sports/server/types';
import type { Profile } from '@/lib/supabase';

interface ProfileAnswer { profile: Profile; canView?: boolean }
type Load =
  | { state: 'loading' }
  | { state: 'missing' }
  | { state: 'private'; profile: Profile }
  | { state: 'ready'; profile: Profile; cards: SportSkillCard[] }
  // A tagged player who has not claimed their profile (312): the sport profile only, under a short name.
  | { state: 'unclaimed'; view: UnclaimedView };

/** A placeholder has no skill cards: its sports are the ones it has film in. */
const cardsOf = (view: UnclaimedView): SportSkillCard[] =>
  view.sports.map(s => ({ sportKey: s.sportKey as SportSkillCard['sportKey'], sportLabel: s.sportLabel, headline: null, progress: null, tiles: [], entered: [], detailHref: null, enabled: true, state: 'empty', pinned: false, pinOrder: null }));

const STALE_MS = 60_000;

export default function AthleteSportProfilePage() {
  const { id, sport } = useParams<{ id: string; sport: string }>();
  const { user, loading: authLoading, initialAuthCheckComplete } = useAuth();
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  // Bumped when a request, an answer or the private switch changed the unclaimed page.
  const [rev, setRev] = useState(0);

  // Signed out: the login form is `/`.
  useEffect(() => {
    if (initialAuthCheckComplete && !authLoading && !user) router.push('/');
  }, [initialAuthCheckComplete, authLoading, user, router]);

  useEffect(() => {
    if (!user || !id) return;
    let cancelled = false;
    const profileUrl = `/api/profile?id=${id}`;
    const cardsUrl = `/api/profile/${id}/skill-cards`;
    Promise.all([
      readCached<ProfileAnswer>(profileUrl, () => fetchJson<ProfileAnswer>(profileUrl), { staleMs: STALE_MS }).then(data => ({ data, error: null as unknown })).catch((error: unknown) => ({ data: null, error })),
      readCached<{ skillCards?: SportSkillCard[] }>(cardsUrl, () => fetchJson(cardsUrl), { staleMs: STALE_MS }).catch(() => null),
    ]).then(([profile, cards]) => {
      if (cancelled) return;
      if (!profile.data) { setLoad({ state: httpStatus(profile.error) === 404 ? 'missing' : 'missing' }); return; }
      const mayView = profile.data.canView !== false || profile.data.profile.id === user.id;
      if (mayView) { setLoad({ state: 'ready', profile: profile.data.profile, cards: cards?.skillCards ?? [] }); return; }
      // Private to this viewer: it may still be an unclaimed placeholder, whose sport profile is open.
      const closed = profile.data.profile;
      fetch(`/api/profile/${id}/unclaimed`, { credentials: 'include' })
        .then(async r => (r.ok ? ((await r.json()) as { unclaimed: UnclaimedView }).unclaimed : null))
        .catch(() => null)
        .then(view => { if (!cancelled) setLoad(view ? { state: 'unclaimed', view } : { state: 'private', profile: closed }); });
    });
    return () => { cancelled = true; };
  }, [id, user, rev]);

  // A link that names a sport the athlete does not have opens the first in their own order.
  const cards = load.state === 'ready' ? load.cards : load.state === 'unclaimed' ? cardsOf(load.view) : [];
  const landing = load.state === 'ready' || load.state === 'unclaimed' ? landingSport(cards, sport) : null;
  useEffect(() => {
    if ((load.state === 'ready' || load.state === 'unclaimed') && landing && landing !== sport) router.replace(`/athlete/${id}/sport/${landing}`);
  }, [load.state, landing, sport, id, router]);

  if (load.state === 'loading' || !user) return <RouteLoading message="Loading sport profile..." />;
  if (load.state === 'private') {
    return (
      <div className="min-h-screen bg-canvas">
        <AppHeader showSearch={false} />
        <PrivateProfileView profile={load.profile} />
      </div>
    );
  }
  if (load.state === 'unclaimed') {
    const v = load.view;
    return (
      <div className="min-h-screen bg-canvas pb-24 lg:pb-8">
        <AppHeader showSearch={true} />
        <div className="mx-auto w-full max-w-4xl px-4 pt-6 sm:px-6">
          <UnclaimedBanner view={v} onChanged={() => setRev(r => r + 1)} />
        </div>
        {landing ? (
          <SportProfile key={rev} profileId={v.profile_id} name={v.name} avatarUrl={null} cards={cards} sport={landing} profilePath={`/athlete/${v.profile_id}/sport/${landing}`} sportPath={key => `/athlete/${v.profile_id}/sport/${key}`} />
        ) : (
          <p className="mx-auto max-w-4xl px-4 text-secondary sm:px-6" data-unclaimed-empty="">There are no tagged games for {v.name} here.</p>
        )}
      </div>
    );
  }
  if (load.state === 'missing' || !landing) {
    return (
      <div className="min-h-screen bg-canvas">
        <AppHeader showSearch={false} />
        <div className="mx-auto max-w-xl px-4 py-16 text-center">
          <h1 className="mb-2 text-2xl font-bold text-primary">{load.state === 'missing' ? 'Athlete not found' : 'No sports yet'}</h1>
          <p className="mb-6 text-secondary">{load.state === 'missing' ? 'This profile is not here.' : 'This athlete has not added a sport.'}</p>
          <button type="button" className="ea-cta inline-flex min-h-[44px] items-center rounded-lg px-4 text-sm font-semibold text-white" onClick={() => router.push(load.state === 'missing' ? '/feed' : `/athlete/${id}`)}>{load.state === 'missing' ? 'Go to the feed' : 'Back to the profile'}</button>
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
        avatarUrl={p.avatar_url ?? null}
        cards={load.cards}
        sport={landing}
        profilePath={p.id === user.id ? '/athlete' : `/athlete/${p.id}`}
        sportPath={key => `/athlete/${p.id}/sport/${key}`}
      />
    </div>
  );
}
