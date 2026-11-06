'use client';

import { useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { requestPulse } from '@/lib/pulse/pulse-store';

/**
 * The public `live-now` topic (the cost program PR C, Nov 6 2026; migration
 * 301): the database broadcasts one `pulse` event when a golf round, a sport
 * event, an event round or a broadcast enters or leaves "live". The payload
 * says only what kind of thing changed — every client answers by fetching
 * its OWN pulse through the store's signal path (debounced, jittered, so a
 * platform-wide tick is spread). The per-user topic (`user:{id}`, a message
 * or a read) lives on the notifications channel. Mounted once in the (app)
 * layout for signed-in people; signed-out visitors open nothing.
 */
export default function PulseHost() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel('live-now')
      .on('broadcast', { event: 'pulse' }, () => requestPulse('signal'))
      .subscribe((status: string) => {
        // (Re)joined: close the gap a dropped socket may have opened — the
        // rules reuse an answer younger than 30 s, so a fresh mount is free.
        if (status === 'SUBSCRIBED') requestPulse('resume');
      });
    return () => {
      channel.unsubscribe();
    };
  }, [user]);

  return null;
}
