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
import ThemePanel, { themeDraftFrom, type ThemeDraft } from './ThemePanel';
import ChecklistRail from './ChecklistRail';
import Gallery from './Gallery';
import type { GalleryOrg } from '@/lib/site-builder/gallery';
import { isSeedLayout, seedLayout } from '@/lib/site-builder/seeds';
import { buildSiteChecklistSteps, siteChecklistInput } from '@/lib/site-builder/checklist';
import type { ChecklistStep } from '@/lib/orgs/checklist';
import type { WidgetInstance } from '@/lib/site-builder/layout';
import { useDraft, type SaveOutcome } from './useDraft';
import { chipFor, publishBlocker } from '@/lib/site-builder/draft-state';
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
}

const PILL = 'px-3 py-1.5 text-sm min-h-[36px] rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
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
        const fresh = !galleryOffered.current && body.draft === null && body.published !== true && isSeedLayout(body.layout, seedLayout(body.site));
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
    return (
      <div className="min-h-screen bg-canvas">
        <AppHeader showSearch={false} />
        <div className="flex items-center justify-center py-20">
          <div className="text-center max-w-md mx-auto px-4">
            <h1 className="text-2xl font-bold text-primary mb-2">{unavailable ? 'The editor isn’t enabled yet' : 'Managers only'}</h1>
            <p className="text-sm text-tertiary mb-4">
              {unavailable
                ? 'The site editor is being rolled out. Your site keeps working from the console meanwhile.'
                : 'The site editor is for the organization’s owner, managers and website staff.'}
            </p>
            <Link href={consoleHref} className="text-sm text-brand-fg hover:text-brand-fg-strong font-medium">
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
  showSuccess: (title: string, message?: string) => void;
  showError: (title: string, message?: string) => void;
  showUndo: (title: string, onUndo: () => void, message?: string) => void;
}) {
  const history = useHistory<SiteLayout>(canvas.layout);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // P3-D: the canvas data grows as widgets are added (the picker resolved
  // them); a removed widget's data stays — harmless, and Undo needs it.
  const [data, setData] = useState<SiteHomeData>(canvas.data);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Phase 11: the design gallery — 'auto' on a fresh site (shows Skip).
  const [gallery, setGallery] = useState<'auto' | 'manual' | null>(autoGallery ? 'auto' : null);
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

  const addWidget = (key: SiteWidgetKey, resolved: SiteHomeData | null) => {
    if (resolved) setData(prev => ({ ...prev, ...resolved }));
    const id = newInstanceId();
    history.commit(appendWidget(history.present, newInstanceFor(site, key, id)));
    setPickerOpen(false);
    // Phase 6: a content tile is empty until authored — open its panel at once;
    // phase 9: so is a repeat of a query widget (it needs binding).
    if (isContentWidgetKey(key) || WIDGETS[key].multiple) setSelectedId(id);
  };
  const removeOne = (id: string) => {
    const gone = history.present.widgets.find(w => w.id === id);
    if (!gone) return;
    history.commit(removeWidget(history.present, id));
    setSelectedId(null);
    showUndo('Section removed', history.undo, 'Nothing changes on your site until you publish.');
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
          body: JSON.stringify({ layout, ...(baseRev !== null ? { baseRev } : {}) }),
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
    [plural, orgId, showError]
  );
  const draft = useDraft(history.present, save, canvas.draft?.rev ?? null);
  const refreshSite = async () => {
    try {
      const res = await fetch(`/api/${plural}/${orgId}/site/canvas`);
      if (!res.ok) return;
      const body = (await res.json()) as CanvasBody;
      setSite(body.site);
      setData(prev => ({ ...prev, ...body.data }));
      if (body.options) setOptions(body.options);
      // The content save wrote the draft and bumped its rev (P6-B found the
      // gap: without this the next layout autosave answered 409).
      draft.adoptRev(body.draft?.rev ?? null);
    } catch {
      /* the panel's toast already said what happened */
    }
  };

  // ⌘Z / ⇧⌘Z (Ctrl on Windows) — always available, alongside the buttons.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      e.preventDefault();
      if (e.shiftKey) history.redo();
      else history.undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [history]);

  const preview = async () => {
    try {
      const res = await fetch(`/api/${plural}/${orgId}/site/preview`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) {
        showError('Website', body.error || 'Failed to create a preview link');
        return;
      }
      window.open(body.url, '_blank', 'noopener');
    } catch {
      showError('Website', 'Failed to create a preview link');
    }
  };

  // P8-B: the checklist, derived from what the editor holds — no fetch of
  // its own; a step's href names what completes it.
  const [published, setPublished] = useState<boolean>(canvas.published === true);
  const steps = buildSiteChecklistSteps(siteChecklistInput(site, history.present, data, published));
  const onStep = (step: ChecklistStep) => {
    const href = step.href ?? '';
    if (href === '#theme') {
      setSelectedId(null);
      setThemeDraft(themeDraftFrom(site));
    } else if (href === '#gallery') {
      setGallery('manual');
    } else if (href === '#picker') {
      setPickerOpen(true);
    } else if (href === '#publish') {
      void publish();
    } else if (href.startsWith('#w=')) {
      setThemeDraft(null);
      setSelectedId(href.slice(3));
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
      const res = await fetch(`/api/${plural}/${orgId}/site/revisions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'publish' }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        showError('Website', body.error || 'Could not publish the changes');
        return;
      }
      showSuccess('Website', 'Changes published');
      setPublished(true);
      onReload();
    } catch {
      showError('Website', 'Could not publish the changes');
    } finally {
      setBusy(false);
    }
  };

  const chip = chipFor(draft.state, draft.dirty);

  return (
    <div className="min-h-screen bg-canvas" data-site-builder="">
      {/* Below lg: the editor needs room. A notice with WORKING doors — never a dead end. */}
      <div className="lg:hidden min-h-screen flex flex-col">
        <div className="flex items-center justify-between gap-2 border-b border-border bg-surface px-4 py-3">
          <Link href={consoleHref} className="text-sm text-brand-fg hover:text-brand-fg-strong font-medium">
            ← Console
          </Link>
          <span className="text-sm font-semibold text-primary">Site editor</span>
        </div>
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="max-w-sm text-center space-y-4">
            <h1 className="text-xl font-bold text-primary">The editor needs a bigger screen</h1>
            <p className="text-sm text-tertiary">
              Arranging your site works on a screen at least 1024px wide — a laptop or a tablet held sideways. You can still preview and publish from here.
            </p>
            <div className="flex flex-col gap-2">
              <button type="button" onClick={() => void preview()} className={PILL}>
                Preview draft
              </button>
              <button type="button" onClick={() => void publish()} disabled={busy} className={CTA}>
                Publish changes
              </button>
              <Link href={consoleHref} className={PILL}>
                Back to the console
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="hidden lg:flex min-h-screen flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-border bg-surface/95 backdrop-blur px-4 py-2">
          <div className="flex items-center gap-3 min-w-0">
            <Link href={consoleHref} className="text-sm text-brand-fg hover:text-brand-fg-strong font-medium shrink-0">
              ← Console
            </Link>
            <span className="text-sm font-semibold text-primary truncate">{site.orgName} · Site editor</span>
            <span className={`text-xs ${chip.cls}`} data-sb-status={draft.status} data-sb-dirty={draft.dirty ? '1' : '0'} data-sb-theme-preview={themeDraft ? '1' : '0'}>
              {chip.text}
            </span>
          </div>
          <div className="flex items-center gap-2">
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
            <button type="button" onClick={() => setGallery('manual')} className={PILL} data-sb-open-gallery="">
              Start from
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedId(null);
                setThemeDraft(d => (d ? null : themeDraftFrom(site)));
              }}
              aria-pressed={themeDraft !== null}
              className={PILL}
            >
              Theme
            </button>
            <button type="button" onClick={() => void preview()} className={PILL}>
              Preview
            </button>
            <button type="button" onClick={() => void publish()} disabled={busy} className={CTA}>
              Publish changes
            </button>
          </div>
        </header>
        <main className="flex-1 px-4 py-6">
          <div className="mx-auto max-w-5xl">
            <ChecklistRail steps={steps} onStep={onStep} />
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
                    setSelectedId(id);
                    if (id) setThemeDraft(null);
                  }}
                  onCommit={history.commit}
                  onRemove={removeOne}
                />
              </div>
              {themeDraft && (
                <ThemePanel
                  site={site}
                  draft={themeDraft}
                  onChange={setThemeDraft}
                  onSaved={async () => {
                    await refreshSite();
                    setThemeDraft(null);
                  }}
                  onClose={() => setThemeDraft(null)}
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
                  site={site}
                  layout={history.present}
                  widget={selected}
                  plural={plural}
                  orgId={orgId}
                  options={options}
                  onInstanceChange={changeInstance}
                  onContentSaved={refreshSite}
                  showError={showError}
                  showSuccess={showSuccess}
                />
              )}
            </div>
          </div>
        </main>
      </div>
      {pickerOpen && (
        <Picker site={site} layout={history.present} plural={plural} orgId={orgId} data={data} onAdd={addWidget} onClose={() => setPickerOpen(false)} />
      )}
      {gallery && canvas.gallery && (
        <Gallery
          site={site}
          org={canvas.gallery}
          plural={plural}
          orgId={orgId}
          auto={gallery === 'auto'}
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
  );
}
