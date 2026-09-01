// Vanity twin (phase 6 R1) — thin re-export of the /org tree's page; the
// delegating [slug] layout carries the flag gate. Literal segment config:
// re-exported consts are invisible to Next's static analysis.
export const revalidate = 300;
export function generateStaticParams(): { slug: string; newsSlug: string }[] {
  return [];
}
export { default, generateMetadata } from '../../../org/[slug]/news/[newsSlug]/page';
