// Vanity twin (phase 6e S2) — thin re-export of the /org tree's course
// page; the delegating [slug] layout carries the flag gate. Literal
// segment config: re-exported consts are invisible to Next's static
// analysis.
export const revalidate = 300;
export function generateStaticParams(): { slug: string; courseId: string }[] {
  return [];
}
export { default, generateMetadata } from '../../../org/[slug]/courses/[courseId]/page';
