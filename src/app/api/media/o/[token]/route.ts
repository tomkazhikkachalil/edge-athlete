/**
 * GET /api/media/o/[token] — the media proxy's OPTIMIZABLE form (speed round
 * 2, Oct 4 2026). Byte-for-byte the same handler as /api/media/[token]; the
 * extra segment is a hint to the CLIENT that Next's image optimizer may fetch
 * this URL (minted only for media anyone may view — proxy-url.ts). The gate
 * lives in the parent handler: the token is verified and the live viewer
 * re-authorized exactly as on the bare path.
 */
export { GET } from '../../[token]/route';
