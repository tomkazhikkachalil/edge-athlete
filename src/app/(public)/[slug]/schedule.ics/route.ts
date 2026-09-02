// Vanity twin (phase 6e S4) — thin re-export of the /org tree's feed
// route; the delegating [slug] layout carries the flag gate. Literal
// segment config: re-exported consts are invisible to Next's static
// analysis.
export const revalidate = 300;
export function generateStaticParams(): { slug: string }[] {
  return [];
}
export { GET } from '../../org/[slug]/schedule.ics/route';
