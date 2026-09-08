// Vanity twin (phase 6 R1 shape) — thin re-export of the /org tree's page;
// the delegating [slug] layout carries the flag gate. Literal segment
// config: re-exported consts are invisible to Next's static analysis.
// Onboarding v2 R5: with the canonical flipped, /org/{slug}/members 301s
// here — a subpage that exists in ONE tree only is a 404 on the other.
export const revalidate = 300;
export function generateStaticParams(): { slug: string }[] {
  return [];
}
export { default, generateMetadata } from '../../org/[slug]/members/page';
