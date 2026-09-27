// Vanity twin (phase 6b C2) of the per-site sitemap.xml route — identical bytes;
// the middleware rewrites a custom host's /sitemap.xml here.
// force-dynamic: see the /org twin — segment config never rides a re-export.
export const dynamic = 'force-dynamic';
export { GET } from '../../org/[slug]/sitemap.xml/route';
