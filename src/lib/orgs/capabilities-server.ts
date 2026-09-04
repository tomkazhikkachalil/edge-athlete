// ── /api/{leagues,clubs}/[id]/capabilities — the console's entry answer ────
// Org staff program (178). "What may THIS signed-in profile do in THIS
// org's console?" — the ladder role, the admin bit, the org-wide sections
// and the division/team grants, as authz computes them. Any signed-in
// user may ask about any org: the answer is their OWN grants (empty for a
// stranger), never a roster. 404 on an unknown org; 42703-safe (pre-178
// reads answer the ladder alone).

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getOrgAndCapabilities,
  hasAnyCapability,
  visibleSections,
  type OrgSide,
} from './authz';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

export async function capabilitiesGET(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  profileId: string
): Promise<NextResponse> {
  const loaded = await getOrgAndCapabilities(admin, side, orgId, profileId);
  if (loaded.status === 'error') {
    console.error('[ORG CAPABILITIES] org fetch error:', loaded.error);
    return NextResponse.json({ error: 'Failed to load organization' }, { status: 500 });
  }
  if (loaded.status === 'not_found') {
    return NextResponse.json(
      { error: side === 'league' ? 'League not found' : 'Club not found' },
      { status: 404 }
    );
  }
  const { caps } = loaded;
  return NextResponse.json({
    role: caps.role,
    isOwner: caps.role === 'owner',
    admin: caps.admin,
    sections: caps.sections,
    scoped: caps.scoped,
    canEnterConsole: hasAnyCapability(caps),
    visibleSections: visibleSections(caps),
  });
}
