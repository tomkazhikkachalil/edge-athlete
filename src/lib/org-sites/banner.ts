// The site's ONE notice band (sports-team website program, P0-2, Sep 27 2026).
//
// Two sources can put a line in the band:
//   1. the manager's standing notice on the hero (`hero_config.notice`,
//      edited in the site editor — DRAFT content, published like the rest);
//   2. an announcement sent with "Show on the site until …" — its
//      notification rows carry `site_notice` + the end date, read by
//      `fetchPublicNotices` at render.
// Announce used to COPY its title into the live `hero_config` (bypassing the
// draft → publish rule), so the next publish of an older draft silently
// wiped it. Now nothing writes the band for an announcement: it is derived
// here at read time, and a time-bound announcement beats the standing notice.
// Pure, zero imports — the boundaries are testable without a clock.

export interface BannerHero {
  notice?: string;
  noticeUntil?: string;
  /** L4: the standing notice's tone (absent = 'warning') and "More" link. */
  noticeTone?: 'info' | 'alert';
  noticeHref?: string;
}

export interface Banner {
  text: string;
  tone: 'warning' | 'info' | 'alert';
  /** An https link (validated by parseHeroConfig), or null. */
  href: string | null;
}

export interface BannerNotice {
  title: string;
  /** YYYY-MM-DD, inclusive; an announcement without one never reaches the band. */
  noticeUntil: string | null;
}

/** The band today, or null. `notices` newest first (the reader's order). An
 *  announcement speaks in today's amber and links to nothing; the standing
 *  notice carries the manager's tone and link (L4). */
export function activeBanner(
  hero: BannerHero,
  notices: readonly BannerNotice[],
  today: string,
  /** A1 (243): a live news post shown "as a site banner until …" — it leads,
   *  and the band links to it. The reader already applied its end date. */
  newsBanner?: { title: string; href: string } | null
): Banner | null {
  if (newsBanner && newsBanner.title) return { text: newsBanner.title, tone: 'warning', href: newsBanner.href };
  const announced = notices.find(n => !!n.title && !!n.noticeUntil && today <= n.noticeUntil);
  if (announced) return { text: announced.title, tone: 'warning', href: null };
  if (!hero.notice) return null;
  if (hero.noticeUntil && today > hero.noticeUntil) return null;
  return { text: hero.notice, tone: hero.noticeTone ?? 'warning', href: hero.noticeHref ?? null };
}
