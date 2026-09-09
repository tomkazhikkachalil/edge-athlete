'use client';

import { useState } from 'react';
import type { PublicSite } from '@/lib/org-sites/server';
import { fieldsFor, contentActionFor, type FieldSpec } from '@/lib/site-builder/fields';
import { contentConfigFor, INSTANCE_TITLE_MAX } from '@/lib/site-builder/config';
import type { WebWidgetKey } from '@/lib/site-builder/catalog';
import type { SiteLayout, WidgetInstance, WidgetVisibility } from '@/lib/site-builder/layout';
import { widgetTitle } from '@/app/(public)/org/[slug]/_components/WidgetBody';

/**
 * The properties panel — Site Builder phase 5 (Sep 9 2026). Generated from
 * the widget's field descriptors (`fields.ts`), never hand-built per widget:
 *  • INSTANCE fields (title, who sees it) commit to the layout — one undo
 *    step each, autosaved with the layout, the tile's heading updating live.
 *  • CONTENT fields (the hero, the contact card) edit the org object through
 *    the console's own PATCH action (set_hero / set_contact — whole-object
 *    replace seeded from the current content), then the canvas re-reads the
 *    site so every tile shows the saved content. Same write as the Website
 *    section: the two surfaces cannot disagree.
 */
export interface PropertiesPanelProps {
  site: PublicSite;
  layout: SiteLayout;
  widget: WidgetInstance;
  plural: string;
  orgId: string;
  onInstanceChange: (next: WidgetInstance) => void;
  onContentSaved: () => Promise<void>;
  showError: (title: string, message?: string) => void;
  showSuccess: (title: string, message?: string) => void;
}

const INPUT = 'w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-primary';
const LABEL = 'block text-xs font-medium text-secondary mb-1';

export default function PropertiesPanel({ site, widget, plural, orgId, onInstanceChange, onContentSaved, showError, showSuccess }: PropertiesPanelProps) {
  const key = widget.key as WebWidgetKey;
  const fields = fieldsFor(key);
  const instanceFields = fields.filter(f => f.scope === 'instance');
  const contentFields = fields.filter((f): f is Exclude<FieldSpec, { kind: 'visibility' }> => f.scope === 'content');
  const action = contentActionFor(key);

  // Content draft: seeded from the org object; saved as a whole object.
  const seed = () => {
    const content = contentConfigFor(site, key);
    const out: Record<string, string> = {};
    for (const f of contentFields) {
      const v = content[f.name];
      out[f.name] = typeof v === 'string' ? v : '';
    }
    return out;
  };
  // Seeded once per mount — the editor mounts this panel with key={instance
  // id}, so switching tiles reseeds; a save writes exactly what is typed.
  const [content, setContent] = useState<Record<string, string>>(seed);
  const [saving, setSaving] = useState(false);

  const dirty = contentFields.some(f => (content[f.name] ?? '') !== ((contentConfigFor(site, key)[f.name] as string | undefined) ?? ''));

  const saveContent = async () => {
    if (!action) return;
    setSaving(true);
    try {
      const existing = contentConfigFor(site, key);
      const payload: Record<string, unknown> = { action };
      // Whole-object replace: every field the console sends, seeded from the
      // saved content for the ones this panel does not show (image, alt, socials…).
      if (action === 'set_hero') {
        payload.imagePath = existing.imagePath;
        payload.imageAlt = existing.imageAlt;
      }
      if (action === 'set_contact') {
        payload.address = existing.address;
        payload.social = existing.social;
      }
      for (const f of contentFields) {
        const v = content[f.name]?.trim();
        if (v) payload[f.name] = v;
      }
      const res = await fetch(`/api/${plural}/${orgId}/site`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        showError('Website', body.error || 'Could not save');
        return;
      }
      await onContentSaved();
      showSuccess('Website', 'Saved to your draft');
    } catch {
      showError('Website', 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const title = key === 'hero' ? 'Hero' : widgetTitle(site, widget);

  return (
    <aside className="w-80 shrink-0 rounded-xl border border-border bg-surface p-4 space-y-4" aria-label="Section properties" data-sb-panel={key}>
      <div>
        <p className="text-xs uppercase tracking-wide text-muted">Section</p>
        <h2 className="text-base font-semibold text-primary truncate">{title}</h2>
      </div>

      {instanceFields.length > 0 && (
        <fieldset className="space-y-3">
          <legend className="text-xs font-medium text-secondary">This section</legend>
          {instanceFields.map(f =>
            f.kind === 'visibility' ? (
              <div key={f.name}>
                <label className={LABEL} htmlFor={`sb-${widget.id}-visibility`}>
                  {f.label}
                </label>
                <select
                  id={`sb-${widget.id}-visibility`}
                  value={widget.visibility}
                  onChange={e => onInstanceChange({ ...widget, visibility: e.target.value as WidgetVisibility })}
                  className={INPUT}
                >
                  <option value="public">Everyone</option>
                  <option value="members">Members only</option>
                </select>
              </div>
            ) : (
              <div key={f.name}>
                <label className={LABEL} htmlFor={`sb-${widget.id}-${f.name}`}>
                  {f.label}
                </label>
                <input
                  id={`sb-${widget.id}-${f.name}`}
                  type="text"
                  maxLength={f.max ?? INSTANCE_TITLE_MAX}
                  value={typeof (widget.config as Record<string, unknown>)[f.name] === 'string' ? ((widget.config as Record<string, string>)[f.name] ?? '') : ''}
                  placeholder={f.name === 'title' ? widgetTitle(site, { ...widget, config: {} }) : undefined}
                  onChange={e => {
                    const v = e.target.value;
                    const next = { ...(widget.config as Record<string, unknown>) };
                    if (v.trim()) next[f.name] = v;
                    else delete next[f.name];
                    onInstanceChange({ ...widget, config: next });
                  }}
                  className={INPUT}
                />
                {f.help && <p className="mt-1 text-xs text-tertiary">{f.help}</p>}
              </div>
            )
          )}
        </fieldset>
      )}

      {contentFields.length > 0 && (
        <fieldset className="space-y-3 border-t border-border pt-4">
          <legend className="text-xs font-medium text-secondary">Content</legend>
          {contentFields.map(f => (
            <div key={f.name}>
              <label className={LABEL} htmlFor={`sb-${widget.id}-${f.name}`}>
                {f.label}
              </label>
              {f.kind === 'textarea' ? (
                <textarea
                  id={`sb-${widget.id}-${f.name}`}
                  rows={3}
                  maxLength={f.max}
                  value={content[f.name] ?? ''}
                  onChange={e => setContent(c => ({ ...c, [f.name]: e.target.value }))}
                  className={INPUT}
                />
              ) : (
                <input
                  id={`sb-${widget.id}-${f.name}`}
                  type={f.kind === 'url' ? 'url' : f.kind === 'email' ? 'email' : f.kind === 'date' ? 'date' : 'text'}
                  maxLength={f.max}
                  value={content[f.name] ?? ''}
                  onChange={e => setContent(c => ({ ...c, [f.name]: e.target.value }))}
                  className={INPUT}
                />
              )}
              {f.help && <p className="mt-1 text-xs text-tertiary">{f.help}</p>}
            </div>
          ))}
          <button
            type="button"
            onClick={() => void saveContent()}
            disabled={!dirty || saving}
            className="min-h-[36px] rounded-md bg-brand px-3 text-sm font-medium text-white hover:bg-brand-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving…' : 'Save content'}
          </button>
          <p className="text-xs text-tertiary">Saves to your draft — nothing goes live until you publish.</p>
        </fieldset>
      )}
    </aside>
  );
}
