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
}

export interface BannerNotice {
  title: string;
  /** YYYY-MM-DD, inclusive; an announcement without one never reaches the band. */
  noticeUntil: string | null;
}

/** The band's text today, or null. `notices` newest first (the reader's order). */
export function activeBanner(hero: BannerHero, notices: readonly BannerNotice[], today: string): string | null {
  const announced = notices.find(n => !!n.title && !!n.noticeUntil && today <= n.noticeUntil);
  if (announced) return announced.title;
  if (!hero.notice) return null;
  if (hero.noticeUntil && today > hero.noticeUntil) return null;
  return hero.notice;
}
