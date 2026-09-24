import OrgStartPage from '@/components/orgs/OrgStartPage';

// ── /league/start — "Start a league" ─────────────────────────────────────────────
// One page for both kinds since Round 5 E-3: src/components/orgs/OrgStartPage.tsx
// (the kind decides the icon, the word, the URL family and the request field).

export default function StartLeaguePage() {
  return <OrgStartPage kind="league" />;
}
