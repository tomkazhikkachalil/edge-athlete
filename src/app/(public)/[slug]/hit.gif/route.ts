// Vanity twin (program 2, E) of the page-view pixel. Route handlers skip the
// delegating layout; identical behaviour to /org/{slug}/hit.gif. Literal
// segment config: a re-exported `dynamic` is invisible to Next's analysis.
export const dynamic = 'force-dynamic';
export { GET, HEAD } from '../../org/[slug]/hit.gif/route';
