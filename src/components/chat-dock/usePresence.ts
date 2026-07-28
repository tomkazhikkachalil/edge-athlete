'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

// Minimal presence: every dock-enabled client joins ONE shared Realtime
// Presence channel keyed by their user id; the synced member set IS the
// online list. Client-only — no DB, no server code. v1 limitations
// (documented): two states (online / not), and phones appear offline
// because the dock (and thus this hook) never mounts there.

export function usePresence(userId: string | null): Set<string> {
  const [onlineIds, setOnlineIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!userId) {
      setOnlineIds(new Set());
      return;
    }
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
