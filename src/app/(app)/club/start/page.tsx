import OrgStartPage from '@/components/orgs/OrgStartPage';

// ── /club/start — "Start a club" ─────────────────────────────────────────────
// One page for both kinds since Round 5 E-3: src/components/orgs/OrgStartPage.tsx
// (the kind decides the icon, the word, the URL family and the request field).

export default function StartClubPage() {
  return <OrgStartPage kind="club" />;
}
