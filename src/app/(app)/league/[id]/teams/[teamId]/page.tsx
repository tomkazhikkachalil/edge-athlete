'use client';

import TeamPage from '@/components/teams/TeamPage';

// The in-app league team page (teams & divisions program, PR 8) — the body is
// the shared TeamPage (`side` parametrises it); this file is the route.
export default function LeagueTeamPage() {
  return <TeamPage side="league" />;
}
