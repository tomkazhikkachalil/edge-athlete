// ── Leaders from members' rounds (Onboarding v2 R5) ─────────────────────────
// fetchPublicStatLeaders needs a competition. A golf org with none yet still
// has leaders — the low rounds and scoring averages its members posted this
// year. Pure: shapes MemberStats boards as PublicLeaderBoard[] so the same
// LeadersTable renders both. The pseudo competition id is stable and never
// a UUID, so nothing links it to a standings page.

import type { PublicLeaderBoard } from './public-data';
import type { MemberStats } from '@/lib/golf/member-stats';

export const MEMBER_ROUNDS_BOARD_ID = 'member-rounds';

export function leadersFromMemberStats(stats: MemberStats): PublicLeaderBoard[] {
  if (stats.boards.length === 0) return [];
  return [
    {
      competitionId: MEMBER_ROUNDS_BOARD_ID,
      competitionName: "From members' posted rounds",
      sportKey: 'golf',
      unsupported: false,
      stats: stats.boards.map(b => ({
        label: b.label,
        valueLabel: b.valueLabel,
        rows: b.rows.map(r => ({
          name: r.name,
          teamName: null,
          value: r.value,
          ...(r.playerHandle ? { playerHandle: r.playerHandle } : {}),
          ...(r.note ? { note: r.note } : {}),
        })),
      })),
    },
  ];
}
