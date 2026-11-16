'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ReelClip } from '@/lib/sport-profile/rules';

export interface ClipsQuery {
  profileId: string;
  sport: string;
  season?: string | null;
  game?: string | null;
  stat?: string | null;
  /** A sheet event (`goal`) — the Clips browser's play type. */
  event?: string | null;
  /** One period of the film (the period split's door). */
  period?: number | null;
  /** The Clips browser: every film game, recreational included. */
  everyFilm?: boolean;
  showHeld?: boolean;
  /** Bumped when something on the page changed (a hide): the reel is read again. */
  rev?: number;
}

interface State { key: string; clips: ReelClip[]; total: number; next: number | null; state: 'loading' | 'ready' | 'error' }

const queryOf = (q: ClipsQuery, cursor: number): string => {
  const p = new URLSearchParams({ sport: q.sport });
  if (q.season) p.set('season', q.season);
  if (q.game) p.set('game', q.game);
  if (q.stat) p.set('stat', q.stat);
  if (q.event) p.set('event', q.event);
  if (q.period) p.set('period', String(q.period));
  if (q.everyFilm) p.set('scope', 'all');
  if (q.showHeld) p.set('spoilers', 'show');
  if (q.rev) p.set('rev', String(q.rev));
  if (cursor > 0) p.set('cursor', String(cursor));
  return `/api/profile/${q.profileId}/sport-clips?${p.toString()}`;
};

/** One reel from the server, a page at a time (GET …/sport-clips). `enabled: false` asks for nothing. */
export function useClips(q: ClipsQuery, enabled: boolean): { clips: ReelClip[]; total: number; state: State['state']; more: (() => void) | undefined } {
  const key = enabled ? queryOf(q, 0) : '';
  const [s, setS] = useState<State>({ key: '', clips: [], total: 0, next: null, state: 'loading' });
  if (s.key !== key) setS({ key, clips: [], total: 0, next: null, state: 'loading' });

  const read = useCallback((url: string, append: boolean, forKey: string, alive: () => boolean) => {
    fetch(url, { credentials: 'include' })
      .then(async r => {
        if (!r.ok) throw new Error(String(r.status));
        return (await r.json()) as { clips: ReelClip[]; next: number | null; total: number };
      })
      .then(body => { if (alive()) setS(prev => (prev.key !== forKey ? prev : { key: forKey, clips: append ? [...prev.clips, ...body.clips] : body.clips, total: body.total, next: body.next, state: 'ready' })); })
      .catch(() => { if (alive()) setS(prev => (prev.key !== forKey ? prev : { ...prev, state: 'error' })); });
  }, []);

  useEffect(() => {
    if (!key) return;
    let live = true;
    read(key, false, key, () => live);
    return () => { live = false; };
  }, [key, read]);

  const next = s.next;
  const more = enabled && next !== null ? () => read(queryOf(q, next), true, key, () => true) : undefined;
  return { clips: s.key === key ? s.clips : [], total: s.key === key ? s.total : 0, state: s.key === key ? s.state : 'loading', more };
}
