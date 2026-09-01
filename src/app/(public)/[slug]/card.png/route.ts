// Vanity twin (phase 6 R1) of the OG card route. Route handlers skip the
// delegating layout, so the flag gate doesn't apply here — deliberately
// fine: it serves the identical bytes as /org/{slug}/card.png (an unknown
// slug 404s inside the handler; no personal data either way).
export { GET } from '../../org/[slug]/card.png/route';
