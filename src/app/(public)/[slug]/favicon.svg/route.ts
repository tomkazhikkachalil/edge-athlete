// Vanity twin (phase 6b B1) of the favicon route. Route handlers skip the
// delegating layout, so the flag gate doesn't apply — deliberately fine:
// identical bytes to /org/{slug}/favicon.svg, an unknown slug 404s inside.
export { GET } from '../../org/[slug]/favicon.svg/route';
