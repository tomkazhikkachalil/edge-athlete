'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

// Minimal presence: a client joins ONE shared Realtime Presence channel
// keyed by its user id; the synced member set IS the online list.
// Client-only — no DB, no server code. v1 limitations (documented): two
// states (online / not), and phones appear offline because the dock (and
// thus this hook) never mounts there.
//
// Scale fix 3 (Oct 25 2026, docs/SCALE_AUDIT.md hole 3): the caller passes a
// user id ONLY while the dock is in use — the panel open, or a mini thread
// open or minimized (ChatDock.tsx). A null id leaves the channel (untrack is
// implicit in leaving) and clears the set. Every signed-in desktop tab used
// to sit in this one channel for its whole life, and a presence `join` /
// `leave` is broadcast to every member: N tabs = N² messages per churn,
// against the 500-connection / 500 msgs-per-second project caps. Now only
// tabs that can SHOW a dot are members, and the panel re-syncs on open
// (presence `sync` fires on join).

export function usePresence(userId: string | null): Set<string> {
  const [onlineIds, setOnlineIds] = useState<Set<string>>(() => new Set());

  // Clearing when the user signs out is synchronisation, not a side effect.
  const [syncedUserId, setSyncedUserId] = useState(userId);
  if (syncedUserId !== userId) {
    setSyncedUserId(userId);
    if (!userId) setOnlineIds(new Set());
  }

  useEffect(() => {
    if (!userId) return;
    const channel = supabase.channel('presence:global', {
      config: { presence: { key: userId } },
    });

    const syncState = () => {
      const state = channel.presenceState();
      setOnlineIds(new Set(Object.keys(state)));
    };

    channel
      .on('presence', { event: 'sync' }, syncState)
      .on('presence', { event: 'join' }, syncState)
      .on('presence', { event: 'leave' }, syncState)
      .subscribe(async (status: string) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ at: new Date().toISOString() });
        }
      });

    return () => {
      supabase.removeChannel(channel);
      setOnlineIds(new Set());
    };
  }, [userId]);

  return onlineIds;
}
