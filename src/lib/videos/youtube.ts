/**
 * The YouTube link helper (Videos program, 296) — the ONE place a pasted
 * link becomes a provider id, and the ONE place an id becomes a frame src.
 *
 * Imports only the site builder's embed module (itself zero-import), so the
 * 11-character id rule and the privacy-enhanced host keep one spelling: the
 * CSP's `frame-src` is built from the same EMBED_FRAME_HOSTS list (pinned by
 * embeds.test.ts), so every frame this module can produce is one the policy
 * admits. What this adds over `parseEmbedUrl`: the timestamp a "share at"
 * link carries (`t=` / `start=` / `#t=` in `1h2m3s`, `90`, `90s` forms),
 * which the site builder drops and a highlight wants.
 *
 * Never a URL from the person's text: `parseYouTubeLink` yields an id, and
 * `embedSrcAt` / `watchUrl` / `thumbUrl` rebuild every URL from it.
 */
import { EMBED_FRAME_HOSTS, embedSrc, parseEmbedUrl } from '@/lib/site-builder/embeds';

export const YOUTUBE_EMBED_HOST = EMBED_FRAME_HOSTS[0];

export interface YouTubeLink {
  id: string;
  /** The `t=` the link carried, in milliseconds — null when it carried none. */
  startMs: number | null;
}

const TIME_RE = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/;

/** `90`, `90s`, `1m30s`, `1h2m3s` → milliseconds; null for anything else. */
export function parseYouTubeTime(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const t = raw.trim();
  if (!t) return null;
  const m = t.match(TIME_RE);
  if (!m || (m[1] === undefined && m[2] === undefined && m[3] === undefined)) return null;
  const h = Number(m[1] ?? 0);
  const min = Number(m[2] ?? 0);
  const s = Number(m[3] ?? 0);
  const total = h * 3600 + min * 60 + s;
  if (!Number.isFinite(total) || total < 0) return null;
  return total * 1000;
}

/** A pasted link → the video id (+ its timestamp), or null when it is not a YouTube video link. */
export function parseYouTubeLink(input: string): YouTubeLink | null {
  const embed = parseEmbedUrl(input);
  if (!embed || embed.provider !== 'youtube') return null;
  let startMs: number | null = null;
  try {
    const url = new URL(input.trim());
    const t = url.searchParams.get('t') ?? url.searchParams.get('start');
    startMs = parseYouTubeTime(t);
    if (startMs === null && url.hash.startsWith('#t=')) startMs = parseYouTubeTime(url.hash.slice(3));
  } catch {
    startMs = null;
  }
  return { id: embed.id, startMs };
}

/** The canonical watch link — what "open it on YouTube" points at. */
export function watchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

/** The player frame's src: the privacy-enhanced host, related videos off,
 *  and — for a highlight — `start=` in whole seconds plus autoplay (the
 *  player remounts on it; no IFrame API script). */
export function embedSrcAt(id: string, startMs: number | null): string {
  const base = `${embedSrc({ provider: 'youtube', id })}?rel=0`;
  if (startMs === null || !Number.isFinite(startMs) || startMs <= 0) return base;
  return `${base}&start=${Math.floor(startMs / 1000)}&autoplay=1`;
}

/** The poster before the frame mounts (img-src https:). */
export function thumbUrl(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}
