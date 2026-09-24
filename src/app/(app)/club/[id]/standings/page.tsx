import type { Metadata } from 'next';
import OrgStandingsPage, { orgStandingsMetadata } from '@/components/orgs/OrgStandingsPage';

// ── /club/[id]/standings — the crawlable public standings ────────────────────
// One server component for both kinds since Round 5 E-3:
// src/components/orgs/OrgStandingsPage.tsx (the kind decides the read's
// side, the org page link and the not-found word).

interface PageParams {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const { id } = await params;
  return orgStandingsMetadata('club', id);
}

export default async function ClubStandingsPage({ params }: PageParams) {
  const { id } = await params;
  return <OrgStandingsPage kind="club" id={id} />;
}
