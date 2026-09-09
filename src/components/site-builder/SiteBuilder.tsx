'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import AppHeader from '@/components/AppHeader';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import type { PublicSite } from '@/lib/org-sites/server';
import type { SiteHomeData } from '@/lib/org-sites/home-data';
import { appendWidget, newInstanceFor, newInstanceId, removeWidget, type SiteLayout } from '@/lib/site-builder/layout';
import type { WebWidgetKey } from '@/lib/site-builder/catalog';
import Canvas from './Canvas';
import Picker from './Picker';
import PropertiesPanel from './PropertiesPanel';
import type { WidgetInstance } from '@/lib/site-builder/layout';
import { useDraft } from './useDraft';
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
 * Flag-gated (FEATURE_SITE_BUILDER): the canvas route answers 404 when off,
 * and this screen says so. Manager-gated by the routes (`manage_site`).
 */

interface CanvasBody {
  site: PublicSite;
  layout: SiteLayout;
  draft: { id: string; rev: number; hasUnpublishedChanges: boolean } | null;
  data: SiteHomeData;
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
      onReload={() => setReloadKey(k => k + 1)}
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
  showSuccess,
  showError,
  showUndo,
}: {
  canvas: CanvasBody;
  plural: string;
  orgId: string;
  consoleHref: string;
  onReload: () => void;
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
  // Phase 5: the site view (content) can change under the editor when the
  // panel saves content — re-read the canvas without touching the layout
  // history (the layout is the manager's; the content is the org's).
  const [site, setSite] = useState<PublicSite>(canvas.site);
  const refreshSite = async () => {
    try {
      const res = await fetch(`/api/${plural}/${orgId}/site/canvas`);
      if (!res.ok) return;
      const body = (await res.json()) as CanvasBody;
      setSite(body.site);
      setData(prev => ({ ...prev, ...body.data }));
    } catch {
      /* the panel's toast already said what happened */
    }
  };
  const changeInstance = (next: WidgetInstance) => {
    history.commit({ ...history.present, widgets: history.present.widgets.map(w => (w.id === next.id ? next : w)) });
  };
  const selected = selectedId ? history.present.widgets.find(w => w.id === selectedId) ?? null : null;

  const addWidget = (key: WebWidgetKey, resolved: SiteHomeData) => {
    setData(prev => ({ ...prev, ...resolved }));
    history.commit(appendWidget(history.present, newInstanceFor(site, key, newInstanceId())));
    setPickerOpen(false);
  };
  const removeOne = (id: string) => {
    const gone = history.present.widgets.find(w => w.id === id);
    if (!gone) return;
    history.commit(removeWidget(history.present, id));
    setSelectedId(null);
    showUndo('Section removed', history.undo, 'Nothing changes on your site until you publish.');
  };

  const save = useCallback(
    async (layout: SiteLayout, baseRev: number | null) => {
      try {
        const res = await fetch(`/api/${plural}/${orgId}/site/draft`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ layout, ...(baseRev !== null ? { baseRev } : {}) }),
        });
        if (res.status === 409) return 'conflict' as const;
        if (!res.ok) return 'error' as const;
        const body = (await res.json()) as { rev: number };
        return { rev: body.rev };
      } catch {
        return 'error' as const;
      }
    },
    [plural, orgId]
  );
  const draft = useDraft(history.present, save, canvas.draft?.rev ?? null, true);

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

  const publish = async () => {
    if (draft.dirty || draft.status === 'saving') {
      showError('Website', 'Wait for the draft to finish saving, then publish.');
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
      onReload();
    } catch {
      showError('Website', 'Could not publish the changes');
    } finally {
      setBusy(false);
    }
  };

  const chip =
    draft.status === 'saving'
      ? { text: 'Saving…', cls: 'text-tertiary' }
      : draft.status === 'conflict'
        ? { text: 'Changed elsewhere — reload', cls: 'text-amber-700' }
        : draft.status === 'offline'
          ? { text: 'Offline — changes are kept here', cls: 'text-amber-700' }
          : draft.status === 'error'
            ? { text: 'Could not save', cls: 'text-red-600' }
            : draft.dirty
              ? { text: 'Unsaved', cls: 'text-tertiary' }
              : draft.status === 'saved'
                ? { text: 'Saved to draft', cls: 'text-emerald-700' }
                : { text: 'Draft', cls: 'text-tertiary' };

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
            <span className={`text-xs ${chip.cls}`} data-sb-status={draft.status} data-sb-dirty={draft.dirty ? '1' : '0'}>
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
            <p className="mb-3 text-xs text-tertiary">
              Drag a section to move it; drag its corner to resize. Every section refuses sizes that would look bad. Nothing goes live until you publish.
            </p>
            <div className="flex items-start gap-4">
              <div className="min-w-0 flex-1">
                <Canvas
                  site={site}
                  layout={history.present}
                  data={data}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onCommit={history.commit}
                  onRemove={removeOne}
                />
              </div>
              {selected && (
                <PropertiesPanel
                  key={selected.id}
                  site={site}
                  layout={history.present}
                  widget={selected}
                  plural={plural}
                  orgId={orgId}
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
        <Picker site={site} layout={history.present} plural={plural} orgId={orgId} onAdd={addWidget} onClose={() => setPickerOpen(false)} />
      )}
    </div>
  );
}
