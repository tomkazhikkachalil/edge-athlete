'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import LazyImage from '@/components/LazyImage';
import LargerWindow from '@/components/bubbles/LargerWindow';
import type { EventApi } from '@/lib/sport-events/client';
import { formatThru, formatToPar } from '@/lib/sport-events/leaderboard';
import type { LeaderboardRow } from '@/lib/sport-events/leaderboard';
import { currentRound } from '@/lib/sport-events/rounds';
import { isMatchFormat } from '@/lib/sport-events/types';
import type { ParticipantView, SportEventViewPayload } from '@/lib/sport-events/view';

/**
 * The in-event player sheet (Events program, phase 4): what a viewer sees
 * when they tap a name on the roster — the MASKED name the view already
 * carries, the avatar, the role, and this event's line (a golf stroke
 * round's board row: position, thru, to par, the total). "View profile"
 * only when the profile is public (`handle` is non-null — `publicHandle`
 * answers null for a private profile, the contest rule): a private
 * person's event stats are public because the event is; their profile
 * is never reached from here. The house bottom sheet, at 390 and up.
 */
export default function EventPlayerSheet({ view, participant, api, onClose }: { view: SportEventViewPayload; participant: ParticipantView; api: EventApi | null; onClose: () => void }) {
  const { event, rounds } = view;
  const round = currentRound(rounds.filter(r => r.status !== 'cancelled'));
  const showsBoard = !isMatchFormat(event.format) && !!round && round.group_post_id !== null && !!api;
  const [row, setRow] = useState<LeaderboardRow | null | undefined>(showsBoard ? undefined : null);

  useEffect(() => {
    if (!showsBoard || !round || !api) return;
    let cancelled = false;
    (async () => {
      const res = await api.leaderboard(round.id);
      if (cancelled) return;
      setRow(res.ok && res.data ? res.data.rows.find(r => r.participantId === participant.id) ?? null : null);
    })();
    return () => { cancelled = true; };
  }, [showsBoard, round, api, participant.id]);

  const role = participant.role === 'organizer' ? 'Host' : participant.role === 'co_organizer' ? 'Co-organizer' : participant.role === 'follower' ? 'Following' : participant.playing ? 'Playing' : 'Not playing';
  const net = event.format === 'stroke_net';
  return (
    <LargerWindow title={participant.name} subtitle={role} onClose={onClose} windowKey="event-player">
      <div className="space-y-4" data-event-player-sheet={participant.profile_id}>
        <div className="flex items-center gap-3">
          <div className="h-14 w-14 rounded-full overflow-hidden bg-surface-muted shrink-0">
            {participant.avatar_url && <LazyImage src={participant.avatar_url} alt="" className="h-full w-full object-cover" />}
          </div>
          <div className="min-w-0">
            <p className="text-base font-bold text-primary truncate">{participant.name}</p>
            <p className="text-sm text-muted">{role}{participant.flight ? ` · Flight ${participant.flight}` : ''}{net && participant.playing ? (participant.handicap_index !== null ? ` · index ${participant.handicap_index}` : ' · no index') : ''}</p>
          </div>
        </div>
        {showsBoard && (
          <dl className="bg-surface-muted rounded-lg px-4 py-1 text-sm" data-event-player-line="">
            {row === undefined && <p className="py-2 text-muted">Loading this event&apos;s line…</p>}
            {row === null && <p className="py-2 text-muted">No scores in this event yet.</p>}
            {row && (
              <>
                <div className="flex justify-between py-2 border-b border-border-subtle"><dt className="text-muted">Position</dt><dd className="text-primary font-semibold">{row.rankLabel}</dd></div>
                <div className="flex justify-between py-2 border-b border-border-subtle"><dt className="text-muted">Thru</dt><dd className="text-primary">{formatThru(row.thru, round?.holes ?? 18)}</dd></div>
                <div className="flex justify-between py-2 border-b border-border-subtle"><dt className="text-muted">To par</dt><dd className="text-primary">{formatToPar(net ? row.netToPar : row.toPar)}</dd></div>
                <div className="flex justify-between py-2"><dt className="text-muted">{net ? 'Net' : 'Total'}</dt><dd className="text-primary font-semibold">{(net ? row.net : row.gross) ?? '—'}</dd></div>
              </>
            )}
          </dl>
        )}
        {participant.handle ? (
          <Link href={`/u/${participant.handle}`} className="ea-interactive inline-flex items-center border border-border-strong text-secondary px-4 min-h-[44px] rounded-lg text-sm font-semibold" data-event-player-profile="">View profile</Link>
        ) : (
          <p className="text-xs text-muted" data-event-player-private="">This profile is private — only their part in this event is shown.</p>
        )}
      </div>
    </LargerWindow>
  );
}
