/**
 * Embeds — Site Builder phase 6 (Sep 9 2026).
 *
 * The embed widget never stores a URL and never renders one it was given:
 * a pasted link is PARSED into `{ provider, id }` (or a map's bbox) and the
 * iframe `src` is REBUILT from that structure against a closed provider
 * list. So the only frames a site can carry are the three the CSP allows
 * (`frame-src` in BOTH `buildCsp` and `buildStaticCsp` reads
 * `EMBED_FRAME_HOSTS`, pinned by test), and a stored config from any build
 * that fails to parse renders nothing rather than something else.
 *
 * Providers: YouTube (privacy-enhanced host), Vimeo, OpenStreetMap (no key,
 * no consent banner — preferred over Google Maps). Pure, client-safe (the
 * panel parses as the manager pastes), zero imports.
 */

export type Embed =
  | { provider: 'youtube'; id: string }
  | { provider: 'vimeo'; id: string }
  | { provider: 'osm'; bbox: [number, number, number, number]; marker?: [number, number] };

export type EmbedProvider = Embed['provider'];

/** The frame origins the renderer can produce — the CSP `frame-src` list. */
export const EMBED_FRAME_HOSTS = [
  'https://www.youtube-nocookie.com',
  'https://player.vimeo.com',
  'https://www.openstreetmap.org',
] as const;

export const EMBED_PROVIDER_LABEL: Record<EmbedProvider, string> = {
  youtube: 'YouTube video',
  vimeo: 'Vimeo video',
  osm: 'OpenStreetMap map',
};

const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID_RE = /^[0-9]{6,12}$/;

const hostIs = (host: string, ...names: string[]) => names.some(n => host === n || host.endsWith(`.${n}`));

function num(v: string | null | undefined): number | null {
  if (v === null || v === undefined || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const inLat = (n: number) => n >= -90 && n <= 90;
const inLon = (n: number) => n >= -180 && n <= 180;

/** A pasted link → a structured embed, or null when it is not one we host. */
export function parseEmbedUrl(input: string): Embed | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase().replace(/^www\.|^m\./, '');

  // YouTube: watch?v=, /shorts/, /embed/, /live/, youtu.be/.
  if (hostIs(host, 'youtube.com', 'youtube-nocookie.com')) {
    const v = url.searchParams.get('v');
    const path = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/);
    const id = v ?? path?.[1] ?? null;
    return id && YOUTUBE_ID_RE.test(id) ? { provider: 'youtube', id } : null;
  }
  if (host === 'youtu.be') {
    const id = url.pathname.slice(1).split('/')[0];
    return YOUTUBE_ID_RE.test(id) ? { provider: 'youtube', id } : null;
  }

  // Vimeo: vimeo.com/123456789, player.vimeo.com/video/123456789.
  if (hostIs(host, 'vimeo.com')) {
    const m = url.pathname.match(/(?:^|\/)(?:video\/)?([0-9]{6,12})(?:\/|$)/);
    return m && VIMEO_ID_RE.test(m[1]) ? { provider: 'vimeo', id: m[1] } : null;
  }

  // OpenStreetMap: the export/embed link (bbox + optional marker), or a share
  // link (`?mlat=&mlon=#map=zoom/lat/lon`) turned into a box around it.
  if (hostIs(host, 'openstreetmap.org')) {
    const bboxParam = url.searchParams.get('bbox');
    if (bboxParam) {
      const parts = bboxParam.split(',').map(p => num(p));
      if (parts.length === 4 && parts.every((p): p is number => p !== null)) {
        const [w, s, e, n] = parts;
        if (!(inLon(w) && inLon(e) && inLat(s) && inLat(n) && w < e && s < n)) return null;
        const marker = url.searchParams.get('marker')?.split(',').map(p => num(p));
        const out: Embed = { provider: 'osm', bbox: [w, s, e, n] };
        if (marker && marker.length === 2 && marker.every((p): p is number => p !== null) && inLat(marker[0]) && inLon(marker[1])) {
          out.marker = [marker[0], marker[1]];
        }
        return out;
      }
      return null;
    }
    const map = url.hash.match(/map=(\d{1,2})\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/);
    if (map) {
      const lat = Number(map[2]);
      const lon = Number(map[3]);
      if (!inLat(lat) || !inLon(lon)) return null;
      const mlat = num(url.searchParams.get('mlat'));
      const mlon = num(url.searchParams.get('mlon'));
      const out = osmEmbedAround(lat, lon, Number(map[1]));
      if (mlat !== null && mlon !== null && inLat(mlat) && inLon(mlon)) out.marker = [round(mlat), round(mlon)];
      else delete out.marker;
      return out;
    }
    return null;
  }
  return null;
}

function round(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}

/** A map centred on a point — the box the share view shows at that zoom
 *  (a 16:9 frame), the point as the marker. The gallery (phase 11) builds
 *  a venue's map from its coordinates with this; the share-link parser
 *  above uses the same box so the two agree. */
export type OsmEmbed = Extract<Embed, { provider: 'osm' }>;

export function osmEmbedAround(lat: number, lon: number, zoom: number): OsmEmbed {
  const z = Math.min(19, Math.max(1, Math.round(zoom)));
  const dLat = 90 / 2 ** z;
  const dLon = 180 / 2 ** z;
  const clampLat = (n: number) => Math.min(90, Math.max(-90, n));
  const clampLon = (n: number) => Math.min(180, Math.max(-180, n));
  return {
    provider: 'osm',
    bbox: [round(clampLon(lon - dLon)), round(clampLat(lat - dLat)), round(clampLon(lon + dLon)), round(clampLat(lat + dLat))],
    marker: [round(clampLat(lat)), round(clampLon(lon))],
  };
}

/** Defensive: a stored config's `embed` → a structured embed, or null.
 *  Never throws (the readers-never-throw rule). */
export function parseEmbed(raw: unknown): Embed | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  switch (r.provider) {
    case 'youtube':
      return typeof r.id === 'string' && YOUTUBE_ID_RE.test(r.id) ? { provider: 'youtube', id: r.id } : null;
    case 'vimeo':
      return typeof r.id === 'string' && VIMEO_ID_RE.test(r.id) ? { provider: 'vimeo', id: r.id } : null;
    case 'osm': {
      const b = r.bbox;
      if (!Array.isArray(b) || b.length !== 4 || !b.every(n => typeof n === 'number' && Number.isFinite(n))) return null;
      const [w, s, e, n] = b as number[];
      if (!(inLon(w) && inLon(e) && inLat(s) && inLat(n) && w < e && s < n)) return null;
      const out: Embed = { provider: 'osm', bbox: [w, s, e, n] };
      const m = r.marker;
      if (Array.isArray(m) && m.length === 2 && m.every(x => typeof x === 'number' && Number.isFinite(x)) && inLat(m[0]) && inLon(m[1])) {
        out.marker = [m[0], m[1]];
      }
      return out;
    }
    default:
      return null;
  }
}

/** The iframe `src` — rebuilt from the structure, never from user text. */
export function embedSrc(e: Embed): string {
  switch (e.provider) {
    case 'youtube':
      return `${EMBED_FRAME_HOSTS[0]}/embed/${e.id}`;
    case 'vimeo':
      return `${EMBED_FRAME_HOSTS[1]}/video/${e.id}`;
    case 'osm': {
      const bbox = e.bbox.map(n => String(round(n))).join(',');
      const marker = e.marker ? `&marker=${round(e.marker[0])},${round(e.marker[1])}` : '';
      return `${EMBED_FRAME_HOSTS[2]}/export/embed.html?bbox=${bbox}&layer=mapnik${marker}`;
    }
  }
}

/** The frame's accessible title. */
export function embedTitle(e: Embed): string {
  return EMBED_PROVIDER_LABEL[e.provider];
}
