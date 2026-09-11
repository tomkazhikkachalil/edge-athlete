'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import AppHeader from '@/components/AppHeader';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import type { PublicSite } from '@/lib/org-sites/server';
import type { SiteHomeData } from '@/lib/org-sites/home-data';
import { appendWidget, newInstanceFor, newInstanceId, removeWidget, type SiteLayout } from '@/lib/site-builder/layout';
import { WIDGETS, isContentWidgetKey, type SiteWidgetKey } from '@/lib/site-builder/catalog';
import type { CanvasOptions } from '@/lib/org-sites/query-options';
import Canvas from './Canvas';
import Picker from './Picker';
import PropertiesPanel from './PropertiesPanel';
import SectionsList from './SectionsList';
import PagePanel from './PagePanel';
import type { CanvasPage } from '@/lib/org-sites/canvas-server';
import { PAGE_WIDGET_KEYS } from '@/lib/site-builder/catalog';
import LargerWindow from '@/components/bubbles/LargerWindow';
import { widgetTitle } from '@/app/(public)/org/[slug]/_components/WidgetBody';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { resizeToPreset } from '@/lib/site-builder/sections';
import ThemePanel, { themeDraftFrom, type ThemeDraft } from './ThemePanel';
import ChecklistRail from './ChecklistRail';
import Gallery from './Gallery';
import type { GalleryOrg } from '@/lib/site-builder/gallery';
import { isFreshSite } from '@/lib/site-builder/seeds';
import { buildSiteChecklistSteps, siteChecklistInput } from '@/lib/site-builder/checklist';
import type { ChecklistStep } from '@/lib/orgs/checklist';
import type { WidgetInstance } from '@/lib/site-builder/layout';
import { useDraft, type SaveOutcome } from './useDraft';
import { chipFor, publishBlocker } from '@/lib/site-builder/draft-state';
import { publishPlan } from '@/lib/site-builder/publish-target';
import { openPreview } from './openPreview';
import ConfirmModal from '@/components/ConfirmModal';
import { COPY } from '@/lib/copy';
import { useHistory } from './useHistory';

/**
 * The site editor — Site Builder P3-B (Sep 9 2026): one screen, one mode.
 * The canvas in the middle is the REAL page with the club's REAL data; drag
 * to move, corner handle to resize; undo/redo always (⌘Z / ⇧⌘Z + buttons);
 * autosave to the draft revision, the status chip reflecting the wire;
 * Preview opens the draft in its own shell; Publish changes promotes it.
 * Desktop-first by design (a ≥1024px screen): below `lg` the same route
 * shows a notice with WORKING buttons — Preview, Publish changes, Back —
 * so a phone never hits a dead end (CSS-only branch, no matchMedia state).
 *
 * Manager-gated by the routes (`manage_site`); since P10-C the Website
 * section's door (the surface flag retired).
 */

interface CanvasBody {
  site: PublicSite;
  layout: SiteLayout;
  draft: { id: string; rev: number; hasUnpublishedChanges: boolean } | null;
  /** Phase 8: is the site live? */
  published?: boolean;
  data: SiteHomeData;
  /** Phase 9: what a query widget can bind to. */
  options?: CanvasOptions;
  /** Phase 11: the org facts the gallery draws its thumbnails from. */
  gallery?: GalleryOrg;
  /** Program 2, B: the custom pages with their layouts; null = pre-185 (no switcher). */
  pages?: CanvasPage[] | null;
}

/** What the editor edits: the home layout, or one page's. */
export type EditorTarget = 'home' | string;

const PILL = 'px-3 py-1.5 text-sm min-h-[36px] rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
// B3: a panel stays in view beside a long canvas (it used to sit at the top
// of the row, off-screen when the selected tile was near the bottom).
const STICKY_ASIDE = 'sticky top-16 self-start max-h-[calc(100vh-5rem)] overflow-y-auto';
const CTA = 'px-3 py-1.5 text-sm min-h-[36px] rounded-md bg-brand text-white font-medium hover:bg-brand-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

export default function SiteBuilder() {
  const params = useParams();
  const side = params.side as string;
  const orgId = params.id as string;
  const validSide = side === 'league' || side === 'club';
  const plural = side === 'league' ? 'leagues' : 'clubs';
  const consoleHref = `/app/org/${side}/${orgId}`;

  const { user, initialAuthCheckComplete } = useAuth();
  const { showSuccess, showError, showUndo } = useToast();
  const [state, setState] = useState<'loading' | 'ready' | 'forbidden' | 'unavailable' | 'error'>('loading');
  const [canvas, setCanvas] = useState<CanvasBody | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Phase 11: the gallery opens ITSELF once, on the first visit to a site
  // nobody has arranged or published — a ref outside the remounted Editor,
  // so a reload (an applied design, a publish) never re-offers it.
  const galleryOffered = useRef(false);
  const [autoGallery, setAutoGallery] = useState(false);
  // Program 2, B3: which layout the editor holds — the home, or a page by
  // id. `?page=<id>` deep-links (read once, in the load effect — the console
  // precedent); a switch flushes the draft, then reloads onto the new target
  // (the spinner path, so the editor mounts on the SERVER's layout and rev).
  const [target, setTarget] = useState<EditorTarget>('home');
  const pendingTarget = useRef<EditorTarget | null>(null);
  const [openPageSettings, setOpenPageSettings] = useState(false);

  useEffect(() => {
    if (!validSide || !user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/${plural}/${orgId}/site/canvas`);
        if (cancelled) return;
        if (res.status === 404) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setState(body.error === 'Not available' ? 'unavailable' : 'forbidden');
          return;
        }
        if (!res.ok) {
          setState(res.status === 401 || res.status === 403 ? 'forbidden' : 'error');
          return;
        }
        const body = (await res.json()) as CanvasBody;
        if (cancelled) return;
        setCanvas(body);
        // The target: a pending switch, else the deep link on first load; a
        // page the server no longer holds falls back to the home.
        const wanted = pendingTarget.current ?? (reloadKey === 0 ? new URLSearchParams(window.location.search).get('page') : null) ?? 'home';
        pendingTarget.current = null;
        const next: EditorTarget = wanted !== 'home' && (body.pages ?? []).some(p => p.id === wanted) ? wanted : 'home';
        setTarget(next);
        const fresh = next === 'home' && !galleryOffered.current && isFreshSite({ draft: body.draft, published: body.published, layout: body.layout, site: body.site });
        if (fresh) galleryOffered.current = true;
        setAutoGallery(fresh);
        setState('ready');
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [validSide, plural, orgId, user?.id, reloadKey]);

  if (!initialAuthCheckComplete || (user && validSide && state === 'loading')) {
    return (
      <div className="min-h-screen bg-canvas">
        <AppHeader showSearch={false} />
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand"></div>
        </div>
      </div>
    );
  }

  if (!user || !validSide || state === 'forbidden' || state === 'unavailable' || state === 'error') {
    const unavailable = state === 'unavailable';
    // H7: a failed read is not "Managers only" — say so, and offer a retry.
    const failed = state === 'error';
    return (
      <div className="min-h-screen bg-canvas">
        <AppHeader showSearch={false} />
        <div className="flex items-center justify-center py-20">
          <div className="text-center max-w-md mx-auto px-4" data-sb-state={state}>
            <h1 className="text-2xl font-bold text-primary mb-2">{failed ? 'The editor couldn’t load' : unavailable ? 'The editor isn’t enabled yet' : 'Managers only'}</h1>
            <p className="text-sm text-tertiary mb-4">
              {failed
                ? 'Something interrupted the read — your draft is untouched. Try again in a moment.'
                : unavailable
                  ? 'The site editor is being rolled out. Your site keeps working from the console meanwhile.'
                  : 'The site editor is for the organization’s owner, managers and website staff.'}
            </p>
            {failed && (
              <button
                type="button"
                onClick={() => {
                  setState('loading');
                  setReloadKey(k => k + 1);
                }}
                className="mb-3 px-3 py-1.5 text-sm min-h-[36px] rounded-md bg-brand text-white font-medium hover:bg-brand-hover transition-colors"
              >
                Try again
              </button>
            )}
            <Link href={consoleHref} className="block text-sm text-brand-fg hover:text-brand-fg-strong font-medium">
              Back to the console →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return canvas ? (
    <Editor
      key={reloadKey}
      canvas={canvas}
      plural={plural}
      orgId={orgId}
      consoleHref={consoleHref}
      onReload={() => {
        // A real reload: back to the spinner until the fresh canvas lands,
        // so the Editor mounts on the SERVER's layout (an applied design, a
        // publish) — never on the stale one with a new key. The gallery's
        // offer is off for the rest of this page load.
        setAutoGallery(false);
        setState('loading');
        setReloadKey(k => k + 1);
      }}
      autoGallery={autoGallery}
      target={target}
      openPageSettings={openPageSettings}
      onSwitchTarget={(next, opts) => {
        pendingTarget.current = next;
        setOpenPageSettings(opts?.openSettings === true);
        setAutoGallery(false);
        setState('loading');
        setReloadKey(k => k + 1);
      }}
      showSuccess={showSuccess}
      showError={showError}
      showUndo={showUndo}
    />
  ) : null;
}

function Editor({
  canvas,
  plural,
  orgId,
  consoleHref,
  onReload,
  autoGallery,
  target,
  openPageSettings,
  onSwitchTarget,
  showSuccess,
  showError,
  showUndo,
}: {
  canvas: CanvasBody;
  plural: string;
  orgId: string;
  consoleHref: string;
  onReload: () => void;
  /** Phase 11: open the gallery at mount (a fresh site's first visit). */
  autoGallery: boolean;
  /** Program 2, B3: the layout this editor holds. */
  target: EditorTarget;
  /** Open the page's settings sheet at mount (a page just created). */
  openPageSettings: boolean;
  /** Flush, then reload onto another target. */
  onSwitchTarget: (next: EditorTarget, opts?: { openSettings?: boolean }) => void;
  showSuccess: (title: string, message?: string) => void;
  showError: (title: string, message?: string) => void;
  showUndo: (title: string, onUndo: () => void, message?: string) => void;
}) {
  // Program 2, B3: the layout under edit — the home's, or the page's.
  const isHome = target === 'home';
  const page = isHome ? null : (canvas.pages ?? []).find(p => p.id === target) ?? null;
  const history = useHistory<SiteLayout>(page ? page.layout : canvas.layout);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pagePanelOpen, setPagePanelOpen] = useState(openPageSettings && !!page);
  // A1 (Sep 11 2026): below lg the panels are bottom sheets. A JS gate, not
  // CSS: a LargerWindow locks scroll and moves focus even when display:none'd.
  const isDesktop = useIsDesktop();
  const [busy, setBusy] = useState(false);
  // P3-D: the canvas data grows as widgets are added (the picker resolved
  // them); a removed widget's data stays — harmless, and Undo needs it.
  const [data, setData] = useState<SiteHomeData>(canvas.data);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Phase 11: the design gallery — 'auto' on a fresh site (shows Skip).
  const [gallery, setGallery] = useState<'auto' | 'manual' | null>(autoGallery ? 'auto' : null);
  // H7: unsaved panel work (a typed headline, a previewed accent) used to
  // vanish on a stray tile click. The panels report their dirtiness; a
  // navigation that would drop it asks first (the house ConfirmModal).
  const [, setPanelDirty] = useState(false);
  const [, setThemeDirty] = useState(false);
  const [pending, setPending] = useState<(() => void) | null>(null);
  // A1 (Sep 11 2026): the guard reads a REF, not render state. A window's
  // Escape listener re-subscribes in a passive effect; a key pressed right
  // after typing reached the OLD closure (dirty = false) and closed the
  // sheet without asking. The ref is written in the report callbacks (never
  // during render), so every listener sees the truth at the keystroke.
  const dirtyRef = useRef({ panel: false, theme: false });
  const reportPanelDirty = useCallback((dirty: boolean) => {
    dirtyRef.current.panel = dirty;
    setPanelDirty(dirty);
  }, []);
  const reportThemeDirty = useCallback((dirty: boolean) => {
    dirtyRef.current.theme = dirty;
    setThemeDirty(dirty);
  }, []);
  const guarded = (action: () => void) => {
    if (dirtyRef.current.panel || dirtyRef.current.theme) setPending(() => action);
    else action();
  };
  // Phase 5: the site view (content) can change under the editor when the
  // panel saves content — re-read the canvas without touching the layout
  // history (the layout is the manager's; the content is the org's).
  const [site, setSite] = useState<PublicSite>(canvas.site);
  const [options, setOptions] = useState<CanvasOptions | undefined>(canvas.options);
  // P7-B: the theme panel edits a DRAFT of the tokens; the canvas wears the
  // draft while the panel is open (live preview), the server on Save.
  const [themeDraft, setThemeDraft] = useState<ThemeDraft | null>(null);
  const canvasSite: PublicSite = themeDraft ? { ...site, template_id: themeDraft.templateId, theme_token_set: themeDraft.tokens } : site;
  // `coalesce`: consecutive edits to the same field fold into ONE undo step
  // (typing a paragraph is one step, not one per keystroke).
  const changeInstance = (next: WidgetInstance, coalesce?: string) => {
    history.commit({ ...history.present, widgets: history.present.widgets.map(w => (w.id === next.id ? next : w)) }, coalesce);
  };
  const selected = selectedId ? history.present.widgets.find(w => w.id === selectedId) ?? null : null;

  // B3: a new tile lands at the bottom of the page — scroll it into view once
  // it has rendered, or adding e.g. "Staff" from the picker visibly did nothing.
  const scrollToInstance = (id: string) => {
    window.setTimeout(() => document.querySelector(`[data-sb-instance="${id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 0);
  };
  const addWidget = (key: SiteWidgetKey, resolved: SiteHomeData | null) => {
    if (resolved) setData(prev => ({ ...prev, ...resolved }));
    const id = newInstanceId();
    history.commit(appendWidget(history.present, newInstanceFor(site, key, id)));
    setPickerOpen(false);
    scrollToInstance(id);
    // Phase 6: a content tile is empty until authored — open its panel at once;
    // phase 9: so is a repeat of a query widget (it needs binding).
    if (isContentWidgetKey(key) || WIDGETS[key].multiple) setSelectedId(id);
  };
  const removeOne = (id: string) => {
    const gone = history.present.widgets.find(w => w.id === id);
    if (!gone) return;
    // H6: the toast's Undo restores THIS removal — the layout as it was —
    // not "whatever happened last" (history.undo would revert a drag made
    // while the 8 s toast was still up and leave the section deleted).
    const before = history.present;
    history.commit(removeWidget(history.present, id));
    setSelectedId(null);
    showUndo('Section removed', () => history.commit(before), 'Nothing changes on your site until you publish.');
  };

  // H5: the wire mapped to what the editor can act on — a 400 says WHICH
  // section is wrong (and the toast repeats it), the pre-180 409 is not a
  // conflict, a 429 retries itself; only a real network failure is 'network'.
  const save = useCallback(
    async (layout: SiteLayout, baseRev: number | null): Promise<SaveOutcome> => {
      try {
        const res = await fetch(`/api/${plural}/${orgId}/site/draft`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ layout, ...(baseRev !== null ? { baseRev } : {}), ...(target !== 'home' ? { pageId: target } : {}) }),
        });
        if (res.ok) {
          const body = (await res.json()) as { rev: number };
          return { kind: 'ok', rev: body.rev };
        }
        const body = (await res.json().catch(() => ({}))) as { error?: string; issues?: { id?: string; path?: string; message: string }[] };
        if (res.status === 400) {
          const issues = body.issues && body.issues.length > 0 ? body.issues : [{ message: body.error ?? 'a section is invalid' }];
          showError('Website', `Could not save: ${issues[0].message}`);
          return { kind: 'invalid', issues };
        }
        if (res.status === 409) return body.error?.includes('180') ? { kind: 'unsupported' } : { kind: 'conflict' };
        if (res.status === 429) return { kind: 'ratelimited' };
        return { kind: 'network' };
      } catch {
        return { kind: 'network' };
      }
    },
    [plural, orgId, showError, target]
  );
  const draft = useDraft(history.present, save, canvas.draft?.rev ?? null);
  const refreshSite = async (savedRev?: number | null) => {
    // B3: adopt the rev the content PATCH answered with BEFORE the re-read —
    // the window in which an autosave carried a stale rev is gone, and a
    // failed re-read no longer leaves the rev behind.
    if (savedRev !== undefined) draft.adoptRev(savedRev);
    try {
      const res = await fetch(`/api/${plural}/${orgId}/site/canvas`);
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as CanvasBody;
      setSite(body.site);
      setData(prev => ({ ...prev, ...body.data }));
      if (body.options) setOptions(body.options);
      draft.adoptRev(body.draft?.rev ?? null);
    } catch {
      showError('Website', 'Saved — but the editor could not refresh. Reload to see the change.');
    }
  };

  // ⌘Z / ⇧⌘Z (Ctrl on Windows) — always available, alongside the buttons.
  const { undo, redo, canUndo, canRedo } = history;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      // B3: never undo the layout behind an open dialog (picker, gallery,
      // confirm) or from inside a <select>.
      if (document.querySelector('[role="dialog"]')) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, canUndo, canRedo]);

  // H7: the tab opens ON the click (popup blockers refuse one opened after an await).
  const preview = () => openPreview(plural, orgId, showError);

  // Program 2, B3: switching layouts — save what is pending, then reload
  // onto the target (the editor remounts on the server's layout and rev).
  const switchTarget = (next: EditorTarget, opts?: { openSettings?: boolean; force?: boolean }) => {
    if (next === target && !opts?.openSettings && !opts?.force) return;
    guarded(() => {
      void (async () => {
        const settled = await draft.flush();
        if (settled.status !== 'saved' && settled.status !== 'idle') {
          showError('Website', 'Could not save this page before switching — try again in a moment.');
          return;
        }
        onSwitchTarget(next, opts);
      })();
    });
  };
  const createPage = () => {
    guarded(() => {
      void (async () => {
        const settled = await draft.flush();
        if (settled.status !== 'saved' && settled.status !== 'idle') {
          showError('Website', 'Could not save before adding a page — try again in a moment.');
          return;
        }
        try {
          const res = await fetch(`/api/${plural}/${orgId}/site`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'add_page', title: 'New page' }),
          });
          const body = (await res.json().catch(() => ({}))) as { error?: string; page?: { id: string } };
          if (!res.ok || !body.page) {
            showError('Website', body.error || 'Could not add a page');
            return;
          }
          onSwitchTarget(body.page.id, { openSettings: true });
        } catch {
          showError('Website', 'Could not add a page');
        }
      })();
    });
  };

  // P8-B: the checklist, derived from what the editor holds — no fetch of
  // its own; a step's href names what completes it.
  const [published, setPublished] = useState<boolean>(canvas.published === true);
  const steps = isHome ? buildSiteChecklistSteps(siteChecklistInput(site, history.present, data, published)) : [];
  const onStep = (step: ChecklistStep) => {
    const href = step.href ?? '';
    if (href === '#theme') {
      guarded(() => {
        setSelectedId(null);
        setThemeDraft(themeDraftFrom(site));
      });
    } else if (href === '#gallery') {
      setGallery('manual');
    } else if (href === '#picker') {
      setPickerOpen(true);
    } else if (href === '#publish') {
      void publish();
    } else if (href.startsWith('#w=')) {
      const id = href.slice(3);
      if (id === selectedId && !themeDraft) return;
      guarded(() => {
        setThemeDraft(null);
        setSelectedId(id);
      });
    }
  };

  const publish = async () => {
    // H5: an honest reason, per status — never "wait for saving" on a
    // status that never finishes by itself.
    const blocker = publishBlocker(draft.state, draft.dirty);
    if (blocker) {
      showError('Website', blocker);
      return;
    }
    setBusy(true);
    try {
      // H6: a site that is not live yet goes LIVE from here (the site-level
      // publish, manage_org — it promotes a dirty draft too). A manage_site
      // staffer is refused that; their draft still promotes, and the toast
      // says who can flip the switch.
      const plan = publishPlan(published);
      if (plan.target === 'site') {
        const live = await fetch(`/api/${plural}/${orgId}/site`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'publish' }),
        });
        if (live.ok) {
          showSuccess('Website', plan.success);
          setPublished(true);
          onReload();
          return;
        }
        if (live.status !== 403) {
          const body = await live.json().catch(() => ({}));
          showError('Website', body.error || 'Could not publish the site');
          return;
        }
        showError('Website', plan.forbidden ?? 'Could not publish the site');
        // fall through: promote the draft so the work is at least published for when an owner flips it.
      }
      const label = versionLabel.trim();
      const res = await fetch(`/api/${plural}/${orgId}/site/revisions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'publish', ...(label ? { label } : {}) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        showError('Website', body.error || 'Could not publish the changes');
        return;
      }
      if (plan.target === 'revisions') showSuccess('Website', plan.success);
      setVersionLabel('');
      onReload();
    } catch {
      showError('Website', 'Could not publish the changes');
    } finally {
      setBusy(false);
    }
  };
  const publishCta = publishPlan(published).cta;
  // B3: the console's publish takes a version label; the editor's did not,
  // so everything published from the editor landed in History unlabelled.
  const [versionLabel, setVersionLabel] = useState('');

  const chip = chipFor(draft.state, draft.dirty);

  return (
    <div className="min-h-screen bg-canvas" data-site-builder="">
      {/* Sep 11 2026: ONE header for both widths — the status chip renders once
          (a second copy in a display:none branch would make the e2e locator a
          strict-mode violation). Below lg the main is the Sections list; the
          canvas, rail and panels need lg. */}
      <div className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border bg-surface/95 backdrop-blur px-4 py-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 min-w-0">
            <Link href={consoleHref} className="text-sm text-brand-fg hover:text-brand-fg-strong font-medium shrink-0">
              ← Console
            </Link>
            <span className="text-sm font-semibold text-primary truncate">
              <span className="hidden sm:inline">{site.orgName} · </span>Site editor
            </span>
            <span className={`text-xs ${chip.cls}`} data-sb-status={draft.status} data-sb-dirty={draft.dirty ? '1' : '0'} data-sb-theme-preview={themeDraft ? '1' : '0'}>
              {chip.text}
            </span>
            {canvas.pages !== null && canvas.pages !== undefined && (
              <select
                aria-label="Page"
                value={target}
                onChange={e => {
                  const v = e.target.value;
                  if (v === '__new') createPage();
                  else switchTarget(v);
                }}
                className="min-h-[36px] max-w-[45vw] rounded-md border border-border-strong bg-surface px-2 text-sm text-primary sm:max-w-xs"
                data-sb-page-select=""
              >
                <option value="home">Home</option>
                {canvas.pages.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                    {p.visibility === 'draft' ? ' (draft)' : ''}
                  </option>
                ))}
                <option value="__new">New page…</option>
              </select>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {page && (
              <button type="button" onClick={() => setPagePanelOpen(true)} className={PILL} data-sb-page-settings="">
                Page
              </button>
            )}
            {draft.status === 'conflict' && (
              <button type="button" onClick={onReload} className={PILL}>
                Reload
              </button>
            )}
            <button type="button" onClick={history.undo} disabled={!history.canUndo} className={PILL} aria-label="Undo" title="Undo (⌘Z)">
              Undo
            </button>
            <button type="button" onClick={history.redo} disabled={!history.canRedo} className={PILL} aria-label="Redo" title="Redo (⇧⌘Z)">
              Redo
            </button>
            <button type="button" onClick={() => setPickerOpen(true)} className={PILL}>
              Add section
            </button>
            {isHome && (
              <button type="button" onClick={() => setGallery('manual')} className={PILL} data-sb-open-gallery="">
                Start from
              </button>
            )}
            {isHome && (
              <button
                type="button"
                onClick={() =>
                  guarded(() => {
                    setSelectedId(null);
                    setThemeDraft(d => (d ? null : themeDraftFrom(site)));
                  })
                }
                aria-pressed={themeDraft !== null}
                className={PILL}
              >
                Theme
              </button>
            )}
            <button type="button" onClick={() => void preview()} className={PILL}>
              Preview
            </button>
            {published && (
              <input
                type="text"
                aria-label="Version label"
                value={versionLabel}
                onChange={e => setVersionLabel(e.target.value)}
                placeholder="Label this version (optional)"
                maxLength={60}
                className="hidden lg:block w-48 rounded-md border border-border-strong bg-surface px-3 py-1.5 text-sm text-primary min-h-[36px]"
              />
            )}
            <button type="button" onClick={() => void publish()} disabled={busy} className={CTA}>
              {publishCta}
            </button>
          </div>
        </header>
        <main className="flex-1 px-4 py-6">
          {/* The phone editor: the same draft as a list — size and order per section. */}
          <div className="lg:hidden mx-auto max-w-lg" data-sb-phone="">
            <p className="mb-3 text-xs text-tertiary">
              {page ? `Editing the page “${page.title}”. ` : ''}Edit a section’s words, size or order here. Nothing goes live until you publish.
            </p>
            <SectionsList
              site={site}
              layout={history.present}
              onCommit={history.commit}
              onRemove={removeOne}
              onSelect={id =>
                guarded(() => {
                  setSelectedId(id);
                  setThemeDraft(null);
                })
              }
            />
          </div>
          {/* The phone's panels: the SAME components as the desktop asides, hosted
              by a bottom sheet. The dirty guard (ConfirmModal, z-[60]) sits above. */}
          {!isDesktop && !themeDraft && selected && (
            <LargerWindow title={selected.key === 'hero' ? 'Hero' : widgetTitle(site, selected)} hostsOwnHeading windowKey="sb-panel" onClose={() => guarded(() => setSelectedId(null))}>
              <PropertiesPanel
                key={selected.id}
                variant="sheet"
                site={site}
                layout={history.present}
                widget={selected}
                plural={plural}
                orgId={orgId}
                options={options}
                onInstanceChange={changeInstance}
                onResize={p => history.commit(resizeToPreset(history.present, selected.id, p))}
                onContentSaved={refreshSite}
                onDirtyChange={reportPanelDirty}
                showError={showError}
                showSuccess={showSuccess}
              />
            </LargerWindow>
          )}
          {!isDesktop && themeDraft && (
            <LargerWindow title="Theme" hostsOwnHeading windowKey="sb-theme" onClose={() => guarded(() => setThemeDraft(null))}>
              <ThemePanel
                variant="sheet"
                site={site}
                draft={themeDraft}
                onChange={setThemeDraft}
                onSaved={async () => {
                  await refreshSite();
                  setThemeDraft(null);
                }}
                onClose={() => setThemeDraft(null)}
                onDirtyChange={reportThemeDirty}
                onOpenGallery={() => setGallery('manual')}
                plural={plural}
                orgId={orgId}
                showError={showError}
                showSuccess={showSuccess}
              />
            </LargerWindow>
          )}
          <div className="hidden lg:block mx-auto max-w-5xl">
            {isHome ? <ChecklistRail steps={steps} onStep={onStep} /> : <p className="mb-3 text-sm text-secondary">Editing the page <strong>{page?.title}</strong>. Home, theme and the design gallery are on the Home page.</p>}
            <p className="mb-3 text-xs text-tertiary">
              Drag a section to move it; drag its corner to resize. Every section refuses sizes that would look bad. Nothing goes live until you publish.
            </p>
            <div className="flex items-start gap-4">
              <div className="min-w-0 flex-1">
                <Canvas
                  site={canvasSite}
                  layout={history.present}
                  data={data}
                  selectedId={selectedId}
                  onSelect={id => {
                    if (id === selectedId && !themeDraft) return;
                    guarded(() => {
                      setSelectedId(id);
                      if (id) setThemeDraft(null);
                    });
                  }}
                  onCommit={history.commit}
                  onRemove={removeOne}
                />
              </div>
              {themeDraft && (
                <ThemePanel
                  className={STICKY_ASIDE}
                  site={site}
                  draft={themeDraft}
                  onChange={setThemeDraft}
                  onSaved={async () => {
                    await refreshSite();
                    setThemeDraft(null);
                  }}
                  onClose={() => setThemeDraft(null)}
                  onDirtyChange={reportThemeDirty}
                  onOpenGallery={() => setGallery('manual')}
                  plural={plural}
                  orgId={orgId}
                  showError={showError}
                  showSuccess={showSuccess}
                />
              )}
              {!themeDraft && selected && (
                <PropertiesPanel
                  key={selected.id}
                  className={STICKY_ASIDE}
                  site={site}
                  layout={history.present}
                  widget={selected}
                  plural={plural}
                  orgId={orgId}
                  options={options}
                  onInstanceChange={changeInstance}
                  onResize={p => history.commit(resizeToPreset(history.present, selected.id, p))}
                  onContentSaved={refreshSite}
                  onDirtyChange={reportPanelDirty}
                  showError={showError}
                  showSuccess={showSuccess}
                />
              )}
            </div>
          </div>
        </main>
        {/* The gallery and the picker live at the editor root: LargerWindow is a
            bottom sheet on a phone, so both work at every width (H7 confined the
            gallery only because the phone branch was a dead-end notice). */}
        {gallery && canvas.gallery && (
          <Gallery
          site={site}
          org={canvas.gallery}
          plural={plural}
          orgId={orgId}
          auto={gallery === 'auto'}
          dirty={draft.dirty}
          onFlush={async () => {
            const settled = await draft.flush();
            return settled.status === 'saved' || settled.status === 'idle';
          }}
          onApplied={() => {
            // The server re-laid the draft: reload the whole editor from it
            // (a fresh rev; no undo entry — the console's Discard draft is the way back).
            setGallery(null);
            onReload();
          }}
          onClose={() => setGallery(null)}
          showError={showError}
          showSuccess={showSuccess}
        />
        )}
      </div>
      <ConfirmModal
        isOpen={pending !== null}
        title={COPY.FORMS.DISCARD_TITLE}
        message={COPY.FORMS.DISCARD_CONFIRM}
        confirmText={COPY.FORMS.DISCARD_ACTION}
        onConfirm={() => {
          const run = pending;
          setPending(null);
          reportPanelDirty(false);
          reportThemeDirty(false);
          run?.();
        }}
        onCancel={() => setPending(null)}
      />
      {pickerOpen && (
        <Picker site={site} layout={history.present} plural={plural} orgId={orgId} data={data} onAdd={addWidget} onClose={() => setPickerOpen(false)} allowed={page ? PAGE_WIDGET_KEYS : undefined} />
      )}
      {page && pagePanelOpen && (
        <PagePanel
          page={page}
          plural={plural}
          orgId={orgId}
          onClose={() => setPagePanelOpen(false)}
          onSaved={() => {
            // The page's title / address changed on the server: reload the
            // same target so the header's list and the address are its.
            setPagePanelOpen(false);
            switchTarget(page.id, { force: true });
          }}
          onDeleted={() => {
            setPagePanelOpen(false);
            onSwitchTarget('home');
          }}
          showError={showError}
          showSuccess={showSuccess}
        />
      )}
    </div>
  );
}
