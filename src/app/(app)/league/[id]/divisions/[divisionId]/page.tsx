'use client';

import DivisionPage from '@/components/teams/DivisionPage';

// The in-app league division page (teams & divisions program, PR 9) — the body
// is the shared DivisionPage (`side` parametrises it); this file is the route.
export default function LeagueDivisionPage() {
  return <DivisionPage side="league" />;
}
