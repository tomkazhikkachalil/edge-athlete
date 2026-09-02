import { notFound } from 'next/navigation';
import OrgSiteLayout from '../org/[slug]/layout';

// ── The vanity root segment (phase 6 R1) ────────────────────────────────────
// edgeathlete.<tld>/{slug} — the "NHL.com/team" model, same org-site tree
// as /org/{slug} through THIS delegating layout. The flag gate lives here
// (one place, no DB): flag off → notFound() → the tree is inert and every
// unknown root path 404s exactly as before R1. Param name [slug] matches
// org/[slug] on purpose — the page twins re-export the originals and the
// params key must line up.
// NOTE: NEXT_PUBLIC_* is BUILD-INJECTED — flipping the flag needs a real
// build, not a redeploy (the ORG_SUBDOMAINS precedent).

export const revalidate = 300;
// B1: the per-site favicon rides the same metadata on the vanity tree.
export { generateMetadata } from '../org/[slug]/layout';

export default async function VanityOrgLayout(props: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  if (process.env.NEXT_PUBLIC_VANITY_ORG_PATHS !== '1') notFound();
  return OrgSiteLayout(props);
}
