// ── A site's own 404 (sports-team website program, L4, Sep 27 2026) ──────────
// A page that does not exist ON a real site (/org/{slug}/nope, a removed news
// post, an old team link) renders here — INSIDE the site's layout, so the
// visitor keeps the club's header, menu and footer (the way back) instead of
// the platform's generic 404. An unknown SITE still falls through to
// (public)/not-found.tsx: the layout's own notFound() skips this file.
// Server-only; a not-found receives no params and (public) never reads
// headers, so the way home is the site's own menu above.

export default function OrgSiteNotFound() {
  return (
    <div className="site-container px-4 py-16 text-center" data-site-not-found="">
      <p className="text-6xl font-bold text-brand-fg">404</p>
      <h1 className="mt-3 text-2xl font-bold text-primary">We couldn’t find that page</h1>
      <p className="mx-auto mt-2 max-w-md text-secondary">
        It may have moved, or the link may be mistyped. Use the menu above to find the schedule, teams, news and more.
      </p>
    </div>
  );
}
