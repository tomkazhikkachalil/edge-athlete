/**
 * The public athlete profile's <head> (Round 4, Sep 2026): /u/[handle]
 * shipped with no title, description or social image — the one crawlable
 * athlete surface, invisible to search and blank in a share card, for
 * every sport. One reader (`readPublicHead`, cached an hour per handle)
 * and one pure rule (`buildPublicHead`) serve `generateMetadata` in the
 * route's server layout; `readSitemapAthletes` serves the sitemap.
 *
 * What a private profile gives away: nothing — a generic title and
 * `noindex`. A public profile: the athlete's display name and handle, the
 * sport and school when set, the first line of the bio, the avatar as the
 * social image when it is an https URL (a proxied /api/media path is
 * same-origin and viewer-gated — not a crawler's image).
 */
import type { Metadata } from 'next';
import { unstable_cache } from 'next/cache';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { SPORT_REGISTRY, type SportKey } from '@/lib/sports/SportRegistry';
import { appBaseUrl } from '@/lib/org-sites/urls';

export interface PublicHeadProfile {
  id: string;
  handle: string;
  display_name: string | null;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  bio: string | null;
  sport: string | null;
  school: string | null;
  avatar_url: string | null;
  visibility: string | null;
  updated_at: string | null;
}

const SITE = 'Edge Athlete';
const sportName = (key: string | null): string | null => (key && key in SPORT_REGISTRY ? SPORT_REGISTRY[key as SportKey].display_name : null);

export function buildPublicHead(p: PublicHeadProfile | null): Metadata {
  const base = appBaseUrl();
  if (!p || p.visibility !== 'public') {
    return { title: `Athlete · ${SITE}`, robots: { index: false, follow: false } };
  }
  const name = (p.display_name || p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' ') || `@${p.handle}`).trim();
  const facts = [sportName(p.sport), p.school].filter(Boolean).join(' · ');
  const bio = (p.bio ?? '').split('\n')[0].trim().slice(0, 160);
  const description = bio || (facts ? `${name} — ${facts} on ${SITE}.` : `${name} on ${SITE}.`);
  const canonical = `${base}/u/${encodeURIComponent(p.handle)}`;
  const image = p.avatar_url && /^https:\/\//.test(p.avatar_url) ? p.avatar_url : null;
  return {
    title: `${name} (@${p.handle}) · ${SITE}`,
    description,
    alternates: { canonical },
    openGraph: { title: `${name} (@${p.handle})`, description, url: canonical, type: 'profile', ...(image ? { images: [{ url: image }] } : {}) },
    twitter: { card: 'summary', title: `${name} (@${p.handle})`, description, ...(image ? { images: [image] } : {}) },
  };
}

const COLUMNS = 'id, handle, display_name, full_name, first_name, last_name, bio, sport, school, avatar_url, visibility, updated_at';

/** The head's profile row for a handle (case-insensitive), cached an hour; null when absent. Never throws. */
export const readPublicHead = (handle: string): Promise<PublicHeadProfile | null> =>
  unstable_cache(
    async () => {
      try {
        const { data } = await getSupabaseAdmin().from('profiles').select(COLUMNS).ilike('handle', handle).limit(1).maybeSingle();
        return (data as PublicHeadProfile | null) ?? null;
      } catch {
        return null;
      }
    },
    ['public-head', handle.toLowerCase()],
    { revalidate: 3600 }
  )();

export interface SitemapAthlete { handle: string; lastModified: string | null }
export const SITEMAP_ATHLETE_CAP = 5000;

/** Public, onboarded athletes with a handle — the sitemap's list, cached an hour. */
export const readSitemapAthletes = (): Promise<SitemapAthlete[]> =>
  unstable_cache(
    async () => {
      try {
        const { data } = await getSupabaseAdmin()
          .from('profiles')
          .select('handle, updated_at')
          .eq('visibility', 'public')
          .not('handle', 'is', null)
          .not('onboarded_at', 'is', null)
          .order('updated_at', { ascending: false })
          .limit(SITEMAP_ATHLETE_CAP);
        return ((data ?? []) as Array<{ handle: string | null; updated_at: string | null }>)
          .filter((r): r is { handle: string; updated_at: string | null } => !!r.handle)
          .map(r => ({ handle: r.handle, lastModified: r.updated_at }));
      } catch {
        return [];
      }
    },
    ['sitemap-athletes'],
    { revalidate: 3600 }
  )();
