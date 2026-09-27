'use client';

import TeamPage from '@/components/teams/TeamPage';

// The in-app club team page (teams & divisions program, PR 8) — the body is
// the shared TeamPage (`side` parametrises it); this file is the route.
export default function ClubTeamPage() {
  return <TeamPage side="club" />;
}
