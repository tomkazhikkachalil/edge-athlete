'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import ConfirmModal from '@/components/ConfirmModal';
import type { OrgKind } from '@/lib/orgs/org-ref';
import { navEntries } from '@/lib/org-sites/nav';
import { MODULE_TITLES, NAV_LABEL_MAX, TOGGLEABLE_MODULE_KEYS, isPageNavKey, parseNavConfig } from '@/lib/org-sites/validate';

// ── Subpages & navigation (sports-team website program, H1, Sep 27 2026) ──
// Which subpages the site has and how its header lists them: each section on
// or off, its header label, the order (modules and custom pages together),
// whether a page is in the header, and "Reset to recommended order".
// EXTRACTED from the org console (the markup, labels and data attributes are
// the console's, so its specs read the same) and hosted in the editor's
// Settings — the one-home rule: a manager runs the whole site from the editor.
// Every write is one of the site's own draft actions (set_module · set_nav ·
// set_page · reset_order); `onChanged` lets the host re-read.

export interface NavigationModule {
  module_key: string;
  enabled: boolean;
}

interface NavPageRow {
  id: string;
  slug: string;
  title: string;
  visibility: 'public' | 'draft';
  in_nav?: boolean;
  created_at?: string;
}

type NavigationEditorProps = Parameters<typeof NavigationEditorInner>[0];

/** Keyed on the stored nav config: the label inputs seed from it, and a host
 *  (the console) may mount this before the site has loaded — a new config
 *  remounts the editor with fresh labels (no setState in an effect). */
export default function NavigationEditor(props: NavigationEditorProps) {
  return <NavigationEditorInner key={JSON.stringify(props.navConfig ?? null)} {...props} />;
}

function NavigationEditorInner({
  plural,
  orgId,
  side,
  modules,
  navConfig,
  onChanged,
  beforeStructural,
  onStructural,
  showError,
  showSuccess,
}: {
  plural: string;
  orgId: string;
  side: OrgKind;
  modules: readonly NavigationModule[];
  navConfig: unknown;
  onChanged: () => void | Promise<void>;
  /** The editor: a section on/off also changes the draft LAYOUT on the server
   *  (the toggle governs the tile), so the editor flushes its autosave first
   *  and reloads from the draft after (the gallery's recipe). The console
   *  passes neither — it simply re-reads. */
  beforeStructural?: () => Promise<boolean>;
  onStructural?: () => void;
  showError: (title: string, message?: string) => void;
  showSuccess: (title: string, message?: string) => void;
}) {
  const parsed = useMemo(() => parseNavConfig(navConfig), [navConfig]);
  const [navLabels, setNavLabels] = useState<Record<string, string>>(parsed.labels);
  const [navOrder, setNavOrder] = useState<string[] | null>(null);
  const [pages, setPages] = useState<NavPageRow[]>([]);
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadPages = useCallback(async () => {
    try {
      const res = await fetch(`/api/${plural}/${orgId}/site/pages`);
      if (!res.ok) return;
      const body = (await res.json()) as { pages?: NavPageRow[] };
      setPages(body.pages ?? []);
    } catch {
      // An empty list, never a block (the console's rule).
    }
  }, [plural, orgId]);
  useEffect(() => {
    // Scheduled, not synchronous: no setState inside the effect body.
    const t = setTimeout(() => void loadPages(), 0);
    return () => clearTimeout(t);
  }, [loadPages]);

  const act = async (body: Record<string, unknown>, ok: string, fail: string): Promise<boolean> => {
    const structural = body.action === 'set_module';
    if (structural && beforeStructural && !(await beforeStructural())) {
      showError('Website', 'Your latest edit has not saved yet — try again in a moment.');
      return false;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/${plural}/${orgId}/site`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        showError('Website', json.error || fail);
        return false;
      }
      showSuccess('Website', ok);
      if (structural && onStructural) {
        onStructural();
        return true;
      }
      await loadPages();
      await onChanged();
      return true;
    } catch {
      showError('Website', fail);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const toggleable = modules.filter(m => (TOGGLEABLE_MODULE_KEYS as readonly string[]).includes(m.module_key));
  const rowKeys = toggleable.map(m => m.module_key);
  // Program 2, B5: the pages join the list at their stored places (every
  // page, listed or not — the checkbox is here).
  const pageByKey = new Map<string, NavPageRow>(pages.map(p => [`page:${p.id}`, p]));
  const spine = navEntries(
    { entries: parsed.entries },
    rowKeys,
    pages.map(p => ({ id: p.id, slug: p.slug, title: p.title, visibility: 'public' as const, inNav: true, createdAt: p.created_at ?? '' }))
  ).map(e => (e.kind === 'module' ? e.key : `page:${pages.find(p => p.slug === e.slug)?.id ?? ''}`));
  const order = navOrder ? [...navOrder.filter(k => spine.includes(k)), ...spine.filter(k => !navOrder.includes(k))] : spine;
  const byKey = new Map(toggleable.map(m => [m.module_key, m]));
  const move = (key: string, dir: -1 | 1) => {
    const i = order.indexOf(key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setNavOrder(next);
  };

  if (toggleable.length === 0) return null;

  return (
    <div className="space-y-2" data-sb-navigation="">
      <ul className="space-y-1.5">
        {order.map((key, index) => {
          if (isPageNavKey(key)) {
            const p = pageByKey.get(key);
            if (!p) return null;
            const listed = p.in_nav !== false;
            return (
              <li key={key} className="flex flex-wrap items-center gap-2 min-h-[28px]" data-console-nav-page={p.id}>
                <label className="flex items-center gap-2 text-sm text-secondary min-w-[9rem]">
                  <input
                    type="checkbox"
                    checked={listed}
                    disabled={busy}
                    aria-label={`Show ${p.title} in the header`}
                    onChange={() => void act({ action: 'set_page', pageId: p.id, inNav: !listed }, listed ? 'Page hidden from the header' : 'Page shown in the header', 'Failed to update the page')}
                  />
                  <span className="min-w-0 truncate">{p.title}</span>
                </label>
                <span className="text-xs text-muted">/{p.slug}</span>
                {p.visibility === 'public' ? <span className="text-xs text-emerald-600">page</span> : <span className="text-xs text-amber-600">draft page</span>}
                <span className="flex gap-1">
                  <button type="button" onClick={() => move(key, -1)} disabled={index === 0} aria-label={`Move ${p.title} up`} className="ea-icon-btn h-8 w-8 text-tertiary disabled:opacity-40">
                    ▲
                  </button>
                  <button type="button" onClick={() => move(key, 1)} disabled={index === order.length - 1} aria-label={`Move ${p.title} down`} className="ea-icon-btn h-8 w-8 text-tertiary disabled:opacity-40">
                    ▼
                  </button>
                </span>
              </li>
            );
          }
          const m = byKey.get(key);
          if (!m) return null;
          const label = MODULE_TITLES[key] ?? key;
          return (
            <li key={key} className="flex flex-wrap items-center gap-2 min-h-[28px]">
              <label className="flex items-center gap-2 text-sm text-secondary min-w-[9rem]">
                <input
                  type="checkbox"
                  checked={m.enabled}
                  disabled={busy}
                  aria-label={`Toggle ${label} section`}
                  onChange={() => void act({ action: 'set_module', moduleKey: key, enabled: !m.enabled }, 'Section updated', 'Failed to update the section')}
                />
                {label}
              </label>
              <input
                type="text"
                value={navLabels[key] ?? ''}
                onChange={e => setNavLabels(prev => ({ ...prev, [key]: e.target.value }))}
                maxLength={NAV_LABEL_MAX}
                placeholder={label}
                aria-label={`${label} section label`}
                className="px-2 py-1 border border-border-strong rounded-md outline-none text-xs w-36"
              />
              <span className="flex gap-1">
                <button type="button" onClick={() => move(key, -1)} disabled={index === 0} aria-label={`Move ${label} up`} className="ea-icon-btn h-8 w-8 text-tertiary disabled:opacity-40">
                  ▲
                </button>
                <button type="button" onClick={() => move(key, 1)} disabled={index === order.length - 1} aria-label={`Move ${label} down`} className="ea-icon-btn h-8 w-8 text-tertiary disabled:opacity-40">
                  ▼
                </button>
              </span>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            const ok = await act(
              {
                action: 'set_nav',
                items: order.map(key => ({
                  key,
                  ...(!isPageNavKey(key) && navLabels[key]?.trim() ? { label: navLabels[key].trim() } : {}),
                })),
              },
              'Layout saved',
              'Failed to save the layout'
            );
            if (ok) setNavOrder(null);
          }}
          className="px-3 py-1.5 text-sm rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors disabled:opacity-50"
        >
          Save navigation
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setConfirmReset(true)}
          className="px-3 py-1.5 text-sm rounded-md text-tertiary hover:bg-surface-sunken transition-colors disabled:opacity-50"
        >
          Reset to recommended order
        </button>
      </div>
      <ConfirmModal
        isOpen={confirmReset}
        title="Reset the section order?"
        message={`Sections go back to the recommended ${side} order. Your section labels are kept.`}
        confirmText="Reset"
        onConfirm={() => {
          setConfirmReset(false);
          void (async () => {
            const ok = await act({ action: 'reset_order' }, 'Layout reset to the recommended order', 'Failed to reset the layout');
            if (ok) setNavOrder(null);
          })();
        }}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  );
}
