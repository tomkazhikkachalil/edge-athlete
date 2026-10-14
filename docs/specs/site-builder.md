# Site Builder (public org sites)

> Moved verbatim from CLAUDE.md "Key Conventions" on Oct 13 2026. Convention numbers are kept because code comments and docs cite them. Read the devlog entries each convention names (`docs/devlog.md`) before changing the code it describes.

## Convention 12 — Sites are compositions of registered widgets; edits go to a draft (Site Builder, Sep 9 2026, #616–#643, mig 180 — the ONLY migration; phases 6–11 were zero DDL; phases 1–11 COMPLETE and prod-probed)

**Sites are compositions of registered widgets; edits go to a draft
(Site Builder, Sep 9 2026, #616–#643, mig 180 — the ONLY migration; phases
6–11 were zero DDL; phases 1–11 COMPLETE and prod-probed)** — Tom's design
doc supersedes masterplan §6 ("themed templates, no free-form layout").
The pieces, each with its invariant:
- **Catalog** (`src/lib/site-builder/catalog.ts`, ZERO imports — the
  org-page client chunk reads it): three disjoint key sets — the module-
  backed web widgets (`WEB_WIDGET_KEYS` ≡ `MODULE_KEYS`, pinned by test),
  the CONTENT widgets `text | image | embed` (no module, BOTH surfaces —
  in-app as TILES with `bubbleKey: null`, any number per layout, a
  heading only when the instance sets a title), and the app-only
  widgets. `SITE_WIDGET_KEYS` (web + content) is what a layout may hold.
  **One composition renders the public site AND the in-app org page**
  (phase 10): the org GET carries `composition` (`app-composition.ts`,
  server-only — content tiles RESOLVED there, never raw config or zod in
  the org-page chunk: guardrail 4c), `deriveAppLayout(composition)`
  orders the glance grid in the layout's reading order with the app-only
  and PINNED widgets (members, gallery — they ignore instance visibility)
  interleaved at registry priority; no composition = the recorded
  registry order (pinned by test). Bubbles alias `schedule→events`,
  `venues→courses`, `gallery→photos`; instance titles name the bubble
  and its window.
- **Layout** (`layout.ts`, `layout-schema.ts`): instances `{id (opaque),
  key, x, y, w, h (a MINIMUM height), cv, config, visibility}` on a
  12-column grid (`GRID`); `compactLayout` / `validateLayout` are pure and
  shared by the editor (react-grid-layout — the one approved dep, CSS
  scoped to `.sb-canvas`) and the public renderer (`GridRenderer`: DOM =
  reading order = the phone; **empty widgets never render publicly**,
  `isWidgetEmpty`). A site with no stored layout renders its SEED
  (`seeds.ts seedLayout` — order is the side × sport's, pairing the
  template's); `set_template` re-lays a stored layout with `applySeed`.
- **Config** (`config.ts`, phase 5): two owners — CONTENT lives on the
  org objects the console writes (`hero_config`, `contact_config`, module
  rows) and WINS over the instance (`effectiveConfig`); INSTANCE OPTIONS
  (title …) live on the layout. A content widget's content IS its
  instance (blocks / photo / embed structure), under the publish gate.
  Embeds are a STRUCTURE, never a URL (`embeds.ts`; `frame-src` in BOTH
  CSP builders reads `EMBED_FRAME_HOSTS`). The panel is generated from
  `fields.ts` descriptors, pinned to the zod schemas (`schemas.ts`,
  `instanceSchemaFor`); the server re-asserts every image path against
  THIS site's `org-media/{siteId}/` prefix. **A widget holds a QUERY,
  never data** (phase 9): `config.query` (ONE nested key — content can
  never shadow it) narrows the org-wide read at render (`select.ts
  selectForInstance`, called FIRST by the renderer AND `isWidgetEmpty`);
  standings / schedule / leaders may repeat ("Add another"); pickers
  list what the canvas response's `options` offers; public tiles carry
  `data-widget-id`.
- **Draft → publish → revisions** (`org_site_revisions`, one `snapshot`
  jsonb; `applySiteAction` in `snapshot.ts` is the one reducer; `rev`
  optimistic concurrency): **the content columns of `org_sites` and all
  of `org_site_modules` are the PUBLISHED PROJECTION** — the only writers
  are publish (mirror), the pre-180 fallback and `logo_path`. Logo stays
  live. Publishing changes is `manage_site`; live/offline stays
  `manage_org` and PROMOTES a dirty draft. The canvas reads the draft's
  layout, else the PUBLISHED one, else the seed; a fresh draft inherits
  the published layout. A content save bumps the draft rev — the editor
  adopts it (`useDraft.adoptRev`). Publish writes `stats` (`metrics.ts`).
- **Theme** (`src/lib/org-sites/theme.ts`): the template's decisions
  (header / hero / density / teams) are tokens with the template as
  fallback (`effectiveSpec`); `set_theme` MERGES those keys, `set_template`
  clears them. Heading faces are self-hosted OFL woff2 under
  `public/fonts` — a site loads ONE, only when it picks it (`SiteShell`
  emits its @font-face + preload; never `next/font`). `themeAttrs` dresses
  every themed root (the shell AND the canvas).
- **Editor** (`src/components/site-builder/`): the Website section's
  DOOR since P10-C (the surface flag retired; the console keeps only what
  the editor does not do — subpages & navigation, slug, domain,
  live/offline, History, logo, announce, gallery picks, documents,
  sponsors, pages, news, course photos): canvas, picker, properties panel, theme
  panel (live preview, saved through the console's own actions), the
  checklist rail (`checklist.ts`, derived, `ChecklistStep` shape), undo
  with coalescing (`useHistory`), autosave (`useDraft`). **Below `lg`
  the same route is the Sections list** (Sep 11 2026, #674 —
  `SectionsList.tsx`): the SAME draft in reading order with Move up /
  Move down, Remove (the undo toast) and a named Size per section
  (small · medium · wide = a PRESET over `w`, `SizeControl.tsx`, also the
  panel's `size` field) — every edit is one `history.commit`, autosaved
  like a drag. The helpers are pure in `sections.ts` (`readingOrder`,
  `flowLayout`, `resizeToPreset`, `moveInstance` / `canMove`; the hero
  never moves; no change returns the same object) and every result
  passes `validateLayout`. ONE header for both widths (the status chip
  renders once); the gallery and the picker live at the editor ROOT
  (`LargerWindow` is a bottom sheet on a phone). `onReload` goes back
  through the spinner — a keyed remount alone keeps the stale canvas
  prop.
- **Gallery + metrics** (phase 11, `gallery.ts` / `gallery-ids.ts`,
  `Gallery.tsx`, `metrics-rollup.ts`): `template_id ∈ classic|bold` stays
  the DB FAMILY (mig 170's CHECK); a gallery ENTRY is family + design
  tokens + a seed PLAN, nine of them (golf has six: Clubhouse, Tour,
  Weekly league, Points race, Social, Simple — #673), ≥3 per side ×
  sport. `apply_gallery`
  generates the welcome from the org's real facts and a map only when a
  venue has coordinates (`osmEmbedAround`), lays the org's ENABLED
  modules per the plan and **never creates a module instance the layout
  lacks** (members-only visibility never leaks); `keep` (default) keeps
  the manager's tiles, `clean` clears them first. Thumbnails are block
  diagrams of the SAME seed the server applies (over the canvas GET's
  `gallery` facts) — no iframes, no fetches. The gallery opens itself
  once on a never-arranged, never-published site — and so does the
  console's **welcome design pick** (`WelcomeDesignPick.tsx` on
  `?welcome=1`, the creation-time design moment, #673): both read the
  ONE fresh-site rule `seeds.ts isFreshSite`, a pick applies
  `apply_gallery clean`, so a manager is never offered twice. `GET /api/admin/site-
  metrics` folds the revisions' `stats` into the one-hour question
  (nearest-rank percentiles; `truncated` flags capped reads); the
  dashboard "Site builder" panel shows it and hosts the storage sweep's
  dry run.
- **Hardening round (Sep 9 2026, H1–H8)** — the review's invariants:
  the public page has ONE reader of a layout, `public-view.ts
  publicWidgets` (module enabled → `effectiveAudience` → not empty →
  compacted) and `effectiveAudience` is the ONLY place a renderer, the
  emptiness rule or the in-app projection learns an instance's audience —
  the stored `visibility` is a floor, never a ceiling (a club that goes
  private after arranging is gated at render). Draft writes are FENCED on
  `published_at IS NULL`; publish stamps first, mirrors the site row
  before the module rows, then flips; the autosave has its own bucket
  (`org-site-draft`). The in-app composition comes from the PUBLISHED
  layout only (the brand may come from the draft while offline). The
  reducer never writes a layout the readers refuse (`apply_gallery` is
  validated and clamped) and `set_module` governs the tile on a stored
  layout. The autosave is `draft-state.ts` (one save in flight, typed
  outcomes, `publishBlocker`); a not-yet-live site publishes THE SITE
  from the editor (`publishPlan`); the removal toast undoes the removal;
  the gallery flushes first (it lives at the editor root since #674); `openPreview`
  opens the tab on the click; dirty panels are guarded by the house
  `ConfirmModal`.
- **Pages as compositions (program 2, B — Sep 11 2026, #678–#683, mig 185
  the ONLY DDL)**: a custom page is a layout of the same registered widgets
  as the home (every site widget except the hero — `PAGE_WIDGET_KEYS`;
  module widgets welcome), living in the ONE revision snapshot
  (`snapshot.pages[pageId] = {id, slug, title, visibility, inNav,
  createdAt, layout}`); **`org_site_pages` is its PUBLISHED PROJECTION**
  (the mirror writes whole rows by id after the module rows; `body` is the
  layout's block projection for the legacy renderer and pre-185). `pages`
  is ABSENT when empty (a pre-pages snapshot equals a page-less one);
  `parseSnapshot` MUST carry it (pinned). Legacy bodies convert in app
  code (`pages.ts pageLayoutFromBody`, deterministic
  `legacy:page:<id>:<n>` ids; `blocksFromPageLayout` is the inverse) —
  never SQL. ONE writer: `pages-server.ts` runs on `applyDraftAction`
  (`add_page` — the server mints id + timestamp — / `set_page` /
  `remove_page`; a body PATCH converts to the layout); the canvas carries
  `pages` (null pre-185) and the draft PUT takes `pageId` with the page
  rules (`validatePageLayout`: no hero, page keys, 40 sections). The
  editor holds ONE target (`'home' | pageId`, `?page=` deep link); a
  switch flushes then reloads through the spinner; Theme / Start from /
  the checklist / the first-open gallery are HOME-only; `PagePanel` is the
  page's settings. The header is `nav.ts navEntries`: the MODULES in the
  rows' `sort_order` (never `nav_config`'s order — `reset_order` clears it
  but keeps labels), each listed page before the module that follows it
  in the stored `page:<id>` entries (`NavConfig.entries`; `order` stays
  module-only), unlisted listed pages last by creation time; `inNav:
  false` = reachable, in no header. The public page renders its `layout`
  through `GridRenderer` (`heading` = its h1) over `publicWidgets`; a
  block row renders `PageBlocks`; the draft preview has a page twin
  (`/preview/[token]/[pageSlug]`). Read DEVLOG Sep 11 2026 B1–B6 first.
- **Site settings, forms, analytics (program 2, C–E — Sep 11 2026,
  #685–#694, migs 186–188)**: `seo_config` / `footer_config` on
  `org_sites` ride the snapshot (`seo` / `footer`, ABSENT when empty) and
  the mirror (which never names them pre-186); the theme token `iconPath`
  is the chosen favicon; `metadata.ts siteHead` is the ONE head rule
  (title → org name, description, canonical, social image → `card.png`,
  icon → logo → generated svg) for the home, the pages and the layout;
  `SiteShell` renders the footer config above "Powered by Edge Athlete";
  the editor's **Settings** pill hosts `SitePanel`. **Forms** are the two
  FIXED content widgets `contact_form` / `interest_form` (an age GROUP,
  never a DOB): `SiteFormWidget` is a native `<form>` (no script) posting
  to `/api/public/site-forms/[siteId]/[widgetId]`, which answers a 303 back
  to the page at `#sent-<id>` / `#error-<id>` (a `:target` rule shows the
  line); anti-abuse WITHOUT render-time state (the page is ISR-cached): a
  honeypot, `site-form` (ip) + `site-form-site` (per site) buckets, an HMAC
  form key in the `MEDIA_PROXY_SECRET` family, and the widget must be on
  the PUBLISHED layout; submissions live in `org_site_form_submissions`
  (posture A), notify the owner + managers with a summary (never the
  message) and email the owner; the console **Inbox** (`manage_site`)
  reads them; the daily cron purges (365 d archived / 730 d open;
  HARDENING B5). **Analytics** are first-party only (Tom): `hit.gif` (a
  plain `<img>`, `no-store`, `force-dynamic`; the middleware skips
  `*.gif`) counts a view and one visitor per day for a PUBLISHED page read
  from the same-origin Referer; the mark is `sha256(HMAC(ANALYTICS_SALT,
  day) + ip + ua)` — never the IP, UA or a cookie; bots, `Sec-GPC` /
  `DNT`, previews, foreign referers and a missing salt count nothing (the
  same GIF answers); `bump_site_hit` is service-role only; the daily cron
  prunes marks after 2 days; the console **Visitors** panel and the admin
  dashboard read `org_site_stats_daily`; `docs/ANALYTICS.md` is the
  reference. Read DEVLOG Sep 11 2026 C0–E2 first.
- **Sample data in the editor (program 3, S — Sep 13 2026, #697–#698,
  zero DDL)**: `src/lib/site-builder/sample.ts` is a PURE, client-safe
  generator (no zod / validate / emptiness — the emptiness predicate is
  injected) of realistic, sport-appropriate content in modest volume
  (8 standings rows on the sport's real columns, 3 posts, 6 sponsors, a
  full contact block; people in the MASKED shape with no handle; every
  string carries `SAMPLE_SENTINEL`). `applySample` is applied at the
  editor's RENDER boundary ONLY (`SiteBuilder` → the canvas, the phone
  list, the picker); history, the draft PUT, every `set_*` PATCH, the
  checklist and the publish gate keep the real site / data / layout,
  and a sampled tile renders the WHOLE sample bag through a
  query-stripped clone (`sampleInstance`) — never a merged bag. Sample
  media are base64 SVG data URIs: `orgMediaUrl` passes
  `SAMPLE_MEDIA_URI_RE` through for render and the sponsor / hero
  parsers admit it at their re-check, while every WRITE path stays a
  stored-path regex, so a data URI cannot enter the database. The
  toggle (`data-sb-sample`, on by default, remembered per site in
  localStorage) and the chip (`data-sb-sample-chip`) are the e2e hooks;
  a sampled embed draws `SampleFrame`, never a third-party iframe.
- **Display settings, fit and live content (program 3, D–H — Sep 13
  2026, #699–#706, mig 189 the only DDL)**: every section presents its
  items along the SAME four axes — `variant`, `sort` (+ `order`, the
  manager's own), `count`, `click` — plus `height` (fits the content |
  fixed, scrolls inside) — declared ONCE per widget in
  `src/lib/site-builder/display.ts` and GENERATED everywhere:
  `schemas.ts` builds `displaySchemaFor(key)` from it (the draft PUT
  refuses what the panel could not offer), `fields.ts` emits the
  `'display'` scope, the panel renders the "How it looks" fieldset, and
  the renderers read `instanceDisplay(w)` (INSTANCE only, `query`'s
  rule; every key filled with a validated value or its default — the
  FIRST option is today's look, so an instance without `display`
  renders exactly as before, pinned on every widget). `ReorderList` is
  the one reorder control (Move up / down at every width, pointer drag
  on a desktop). Sponsors carry a tier from the FIXED ladder
  (`SPONSOR_TIERS`) and are edited IN THE EDITOR (`SponsorsField` →
  `set_sponsors`; the console keeps a pointer); news carries a pin ON
  THE POST (189 `pinned_at`; the PATCH refuses it pre-189 by name —
  an UPDATE naming a missing column answers PGRST204, not 42703) and
  expands in place through a native `<details>`; the gallery's strip /
  grid read `SiteHomeData.gallery` over the server-safe `ScrollStrip`.
  **Height**: `h` is the manager's MINIMUM; the public grid grows
  (`minmax(row, auto)`) and a FIXED section keeps its rows ≥ 48rem and
  scrolls inside (CSS only, `data-sb-fit`); the canvas measures every
  tile's content (`.sb-measure`, ONE lazily-created ResizeObserver —
  ref callbacks run before effects) and shows an auto tile at
  `displayH`; `canvas-rgl.ts` copies x / y / w back and NEVER the
  display height — the measured height is never persisted; dragging a
  tile below its content flips it to fixed with the Undo toast
  (`fit.ts resolveResize`). **Live content**: the panel emits what is
  typed (`onContentPreview`, from the change handlers) and the editor
  lays it over the site at the render boundary (`content-preview.ts`,
  the sample overlay's seam) until "Save content"; the contact card's
  fields take `contact_config.order` (`contactRenderOrder`). Read
  DEVLOG Sep 13 2026 S1–H3 first.
- **The sports-team website program (Sep 27–28 2026, #962–#988, mig 243
  the ONLY DDL)** — Tom: a professional team site one person runs. The
  pieces, each with its invariant:
  *Look* — theme tokens `header: 'pro'` (utility strip + logo band) and
  `width: standard | wide` (`.site-container`, never `max-w-4xl`);
  `SiteNav.tsx` (md+ inline links with a Teams `<details>` dropdown from
  `nav-groups.ts`, a CSS-only phone menu — no script); `TeamCrest` +
  the teams `crests` variant; `SocialIcon` (inline SVG, never FA);
  `footer_config.sponsorBar`; `hero_config.noticeTone/noticeHref`; the
  branded site 404; the `:target` gallery lightbox (its image reserves
  its box — a lazy 0×0 image flaked).
  *One home* — the editor carries documents, gallery picks, the logo
  and Subpages & navigation (`NavigationEditor`); the console Website
  section keeps settings only plus the deep links (`deep-link.ts`:
  `?open=settings`, `?section=`, `?news=<id>|new|list|recap:<contest>`).
  *Newsroom* (243) — ONE edit shape (`news-state.ts routeEdit`): an
  unpublished post's columns, a LIVE post's `draft` until Update;
  compare-and-set on `updated_at` (409 carries the latest); scheduling is
  a future `published_at` fenced by `.lte(now)` in every published reader
  (`news-fence.test.ts`); inline `**bold**` / `[label](https://…)` via
  `inline.ts` (never HTML); team / division tags reach those pages.
  *Announce merged into news* — "Notify members" claims `notified_at`
  ONCE (`news-notify-server.ts`; the reminders cron sweeps scheduled
  posts) through Announce's own `fanOutAnnouncement`; "Show as a site
  banner until" leads `activeBanner` (derived at READ time — nothing
  writes live `org_sites` for a notice; `site-row-writers.test.ts`); the
  console form retired, the history and the API stay.
  *Game-day* — `fetchOrgGames` (the org's public fixture / bracket games
  ±60 d, its teams' games in OTHER orgs' public competitions, and its
  teams' sport-event games via `readSideEvents`; home-first, each item
  tagged `teamIds` with the sides as data `pair`) feeds the Results page
  (`/schedule/results` + twin) and the game-day tiles: `GAME_WIDGET_KEYS`
  (`next_game` card | banner, `results` list | strip) — a FOURTH catalog
  key set, web-only, gated by the SCHEDULE module through `moduleKey`
  (`governedByModule`: the module's switch sweeps them too), switch
  `either`, members-only wherever the TEAMS are (they print team names;
  `effectiveAudience`), an optional `teamId` query. Team and division
  pages lead with `nextGameOf` (never a calendar row). A game's STATUS
  change purges the sites that show it (`withSiteFreshness` in
  `lifecycle-server.ts`); its SCORE never does (pinned). The gallery's
  Matchday / Club pro / League central seeds MINT game tiles by seed id
  (`isSeedMinted`) — module tiles are still only arranged.
  *Recaps* — `recap.ts` writes a DRAFT from the masked contest view;
  `source_ref contest:<id>` (243's partial UNIQUE) makes a second click
  the same draft; a private competition's recap drafts for members.
  *Live* — `GET /api/public/org-sites/[slug]/live` (viewer-independent,
  query → 400, 200 `s-maxage=10`, non-200 `no-store`, kill switch
  `PUBLIC_LIVE_SCORES=0`, no rate bucket by design) and THE one client
  island, `src/components/site-live/` (snapshot first, one poller per
  URL, the server's `pollMs`, hidden tab quiet, Save-Data → Refresh) —
  HARDENING B4.11 + guardrail 4e (the island's imports and the
  `(public)` tree's `@/components` allowlist). The static CSP's
  `script-src` is `'self' 'unsafe-inline'` — no `https:`.
  Read DEVLOG Sep 27–28 2026 (P0 … V3) first.
- e2e: a spec that reads the PUBLIC page must first take the site LIVE
  (`PATCH {action:'publish'}`) and, after edits, promote the draft with
  `e2e/helpers/org-site.ts publishSite()`; public-order polls compare
  MODULE instance ids (`data-widget-id`); `getByLabel` needs `exact: true`
  beside sibling aria-labels; a spec that opens the editor on a site it
  has NOT taken live meets the gallery's first-open offer; `e2e/helpers/
  isr.ts` (`settleBody`, `settleStatus`, `awaitDraftSaved`) THROWS on
  exhaustion — never a private copy that returns the last body. Plan:
  `~/.claude/plans/edge-athlete-site-builder-zesty-pnueli.md`; read DEVLOG
  Sep 9 2026 P1-A…P11-B and the hardening round H1–H8 before touching any of it.
