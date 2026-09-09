'use client';

import OrgPage from '@/components/orgs/page/OrgPage';

// The in-app club page. Since R1 of the Org Pages Program (Sep 8 2026) the
// ~980-line body lives in the shared OrgPage (`side` parametrises it); this
// file is the route. `ClubInfo` is re-exported for the edit modal's sake.
export type { ClubInfo } from '@/components/orgs/page/types';

export default function ClubPage() {
  return <OrgPage side="club" />;
}
