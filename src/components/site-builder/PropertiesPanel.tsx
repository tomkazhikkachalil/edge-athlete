'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import type { PublicSite } from '@/lib/org-sites/server';
import { orgMediaUrl } from '@/lib/media/org-site-media';
import { validateFiles } from '@/lib/media/validation';
import { fieldsFor, contentActionFor, type FieldSpec } from '@/lib/site-builder/fields';
import { contentConfigFor, INSTANCE_TITLE_MAX } from '@/lib/site-builder/config';
import type { SiteWidgetKey } from '@/lib/site-builder/catalog';
import type { CanvasOptions } from '@/lib/org-sites/query-options';
import { instanceQuery } from '@/lib/site-builder/config';
import { EMBED_PROVIDER_LABEL, embedSrc, parseEmbed, parseEmbedUrl } from '@/lib/site-builder/embeds';
import type { SiteLayout, WidgetInstance, WidgetVisibility } from '@/lib/site-builder/layout';
import { widgetTitle } from '@/app/(public)/org/[slug]/_components/WidgetBody';
import BlocksField, { readTextBlocks, type TextBlock } from './BlocksField';

/**
 * The properties panel — Site Builder phase 5 (Sep 9 2026). Generated from
 * the widget's field descriptors (`fields.ts`), never hand-built per widget:
 *  • INSTANCE fields (title, who sees it — and, phase 6, a content widget's
 *    blocks / photo / embed) commit to the layout, coalesced into one undo
 *    step per field burst, autosaved with the layout, the tile updating live.
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
  /** Phase 9: what a query widget can bind to (from the canvas response). */
  options?: CanvasOptions;
  onInstanceChange: (next: WidgetInstance, coalesce?: string) => void;
  /** After a content save — with the draft rev the PATCH answered (B3). */
  onContentSaved: (rev: number | null) => Promise<void>;
  className?: string;
  /** H7: the editor guards a tile switch while content is typed and unsaved. */
  onDirtyChange?: (dirty: boolean) => void;
  showError: (title: string, message?: string) => void;
  showSuccess: (title: string, message?: string) => void;
}

const INPUT = 'w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-primary';
const LABEL = 'block text-xs font-medium text-secondary mb-1';
const PILL = 'min-h-[36px] rounded-md border border-border-strong px-3 text-sm text-secondary hover:bg-surface-sunken transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

type Config = Record<string, unknown>;
const asConfig = (c: unknown): Config => (c && typeof c === 'object' ? (c as Config) : {});
const str = (c: Config, k: string): string => (typeof c[k] === 'string' ? (c[k] as string) : '');

export default function PropertiesPanel({ site, widget, plural, orgId, options, onInstanceChange, onContentSaved, showError, showSuccess, onDirtyChange, className }: PropertiesPanelProps) {
  const key = widget.key as SiteWidgetKey;
  const fields = fieldsFor(key);
  const instanceFields = fields.filter(f => f.scope === 'instance');
  const queryFields = fields.filter((f): f is Extract<FieldSpec, { scope: 'query' }> => f.scope === 'query');
  const contentFields = fields.filter((f): f is Exclude<FieldSpec, { kind: 'visibility' | 'blocks' | 'embed' | 'select' | 'number' }> => f.scope === 'content');
  const action = contentActionFor(key);
  const config = asConfig(widget.config);

  /** Patch the instance's config; `coalesce` folds a typing burst into one undo step. */
  const patchConfig = (patch: Config, coalesce?: string) => {
    const next: Config = { ...config };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === '') delete next[k];
      else next[k] = v;
    }
    onInstanceChange({ ...widget, config: next }, coalesce);
  };
  /** Phase 9: patch the instance's QUERY (one nested key; dropped when empty). */
  const query = instanceQuery(widget);
  const patchQuery = (patch: Record<string, string | number | undefined>, coalesce?: string) => {
    const q: Record<string, string | number> = { ...(asConfig(config.query) as Record<string, string | number>) };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === '') delete q[k];
      else q[k] = v;
    }
    patchConfig({ query: Object.keys(q).length > 0 ? q : undefined }, coalesce);
  };

  // Content draft: seeded from the org object; saved as a whole object.
  // Nested names ('social.instagram') read one level down; 'address' (an
  // array of lines) reads as one line per row.
  const readContent = (content: Record<string, unknown>, name: string): string => {
    if (name === 'address') return Array.isArray(content.address) ? content.address.filter((l): l is string => typeof l === 'string').join('\n') : '';
    const [head, tail] = name.split('.');
    const v = tail ? asConfig(content[head])[tail] : content[name];
    return typeof v === 'string' ? v : '';
  };
  const seed = () => {
    const content = contentConfigFor(site, key);
    const out: Record<string, string> = {};
    for (const f of contentFields) out[f.name] = readContent(content, f.name);
    return out;
  };
  // Seeded once per mount — the editor mounts this panel with key={instance
  // id}, so switching tiles reseeds; a save writes exactly what is typed.
  const [content, setContent] = useState<Record<string, string>>(seed);
  const [saving, setSaving] = useState(false);

  const dirty = contentFields.some(f => (content[f.name] ?? '') !== readContent(contentConfigFor(site, key), f.name));
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  const saveContent = async () => {
    if (!action) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { action };
      // Whole-object replace: every field the console's form used to send is
      // on this panel now (P10-C parity), so nothing is carried over blind.
      // 'address' → its non-empty lines (≤ 3); 'social.x' → nested.
      const social: Record<string, string> = {};
      for (const f of contentFields) {
        const v = content[f.name]?.trim();
        if (!v) continue;
        if (f.name === 'address') payload.address = v.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 3);
        else if (f.name.startsWith('social.')) social[f.name.slice(7)] = v;
        else payload[f.name] = v;
      }
      if (Object.keys(social).length > 0) payload.social = social;
      const res = await fetch(`/api/${plural}/${orgId}/site`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; draft?: { rev?: number } | null };
      if (!res.ok) {
        showError('Website', body.error || 'Could not save');
        return;
      }
      await onContentSaved(typeof body.draft?.rev === 'number' ? body.draft.rev : null);
      showSuccess('Website', 'Saved to your draft');
    } catch {
      showError('Website', 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const title = key === 'hero' ? 'Hero' : widgetTitle(site, widget);

  const renderInstanceField = (f: FieldSpec) => {
    const id = `sb-${widget.id}-${f.name}`;
    switch (f.kind) {
      case 'visibility':
        return (
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
        );
      case 'blocks':
        return (
          <div key={f.name}>
            <p className={LABEL}>{f.label}</p>
            <BlocksField idBase={`sb-${widget.id}`} blocks={readTextBlocks(config.blocks)} onChange={(blocks: TextBlock[], coalesce) => patchConfig({ blocks }, coalesce)} />
            {f.help && <p className="mt-1 text-xs text-tertiary">{f.help}</p>}
          </div>
        );
      case 'image':
        return <ImageField key={f.name} id={id} label={f.label} siteId={site.id} plural={plural} orgId={orgId} config={config} onPatch={patchConfig} showError={showError} />;
      case 'embed':
        return <EmbedField key={f.name} id={id} spec={f} config={config} onPatch={patchConfig} />;
      case 'select':
      case 'number':
        return null; // query kinds render in their own fieldset (renderQueryField)
      default: {
        const value = str(config, f.name);
        return (
          <div key={f.name}>
            <label className={LABEL} htmlFor={id}>
              {f.label}
            </label>
            {f.kind === 'textarea' ? (
              <textarea id={id} rows={3} maxLength={f.max} value={value} onChange={e => patchConfig({ [f.name]: e.target.value }, `${id}`)} className={INPUT} />
            ) : (
              <input
                id={id}
                type={f.kind === 'url' ? 'url' : f.kind === 'email' ? 'email' : f.kind === 'date' ? 'date' : 'text'}
                maxLength={f.max ?? INSTANCE_TITLE_MAX}
                value={value}
                placeholder={f.name === 'title' ? widgetTitle(site, { ...widget, config: {} }) : f.kind === 'url' ? 'https://…' : undefined}
                onChange={e => patchConfig({ [f.name]: e.target.value }, `${id}`)}
                className={INPUT}
              />
            )}
            {f.help && <p className="mt-1 text-xs text-tertiary">{f.help}</p>}
          </div>
        );
      }
    }
  };

  // Phase 9: the query fields — a select over the canvas's option lists, or a
  // bounded number. A stored id the list no longer offers stays selectable
  // (and says so) rather than silently changing the tile.
  const renderQueryField = (f: Extract<FieldSpec, { scope: 'query' }>) => {
    const id = `sb-${widget.id}-${f.name}`;
    if (f.kind === 'number') {
      return (
        <div key={f.name}>
          <label className={LABEL} htmlFor={id}>
            {f.label}
          </label>
          <input
            id={id}
            type="number"
            min={f.min}
            max={f.max}
            placeholder={String(f.placeholder)}
            value={query.limit ?? ''}
            onChange={e => {
              const n = parseInt(e.target.value, 10);
              patchQuery({ limit: Number.isFinite(n) ? Math.min(f.max, Math.max(f.min, n)) : undefined }, id);
            }}
            className={INPUT}
          />
          {f.help && <p className="mt-1 text-xs text-tertiary">{f.help}</p>}
        </div>
      );
    }
    const list =
      f.source === 'competitions'
        ? (options?.competitions ?? []).map(c => ({ id: c.id, label: `${c.name}${c.seasonLabel ? ` · ${c.seasonLabel}` : ''}${c.status === 'completed' ? ' (completed)' : ''}` }))
        : (options?.venues ?? []).map(v => ({ id: v.id, label: v.name }));
    const current = query[f.name] ?? '';
    if (list.length === 0 && !current) return null;
    const missing = current !== '' && !list.some(o => o.id === current);
    return (
      <div key={f.name}>
        <label className={LABEL} htmlFor={id}>
          {f.label}
        </label>
        <select id={id} value={current} onChange={e => patchQuery({ [f.name]: e.target.value || undefined })} className={INPUT} data-sb-query={f.name}>
          <option value="">{f.noneLabel}</option>
          {missing && (
            <option value={current} disabled>
              No longer public
            </option>
          )}
          {list.map(o => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
        {f.help && <p className="mt-1 text-xs text-tertiary">{f.help}</p>}
      </div>
    );
  };

  return (
    <aside className={`w-80 shrink-0 rounded-xl border border-border bg-surface p-4 space-y-4 ${className ?? ''}`} aria-label="Section properties" data-sb-panel={key}>
      <div>
        <p className="text-xs uppercase tracking-wide text-muted">Section</p>
        <h2 className="text-base font-semibold text-primary truncate">{title}</h2>
      </div>

      {instanceFields.length > 0 && (
        <fieldset className="space-y-3">
          <legend className="text-xs font-medium text-secondary">This section</legend>
          {instanceFields.map(renderInstanceField)}
        </fieldset>
      )}

      {queryFields.length > 0 && (
        <fieldset className="space-y-3 border-t border-border pt-4" data-sb-query-fields="">
          <legend className="text-xs font-medium text-secondary">What it shows</legend>
          {queryFields.map(renderQueryField)}
        </fieldset>
      )}

      {contentFields.length > 0 && (
        <fieldset className="space-y-3 border-t border-border pt-4">
          <legend className="text-xs font-medium text-secondary">Content</legend>
          {contentFields.map(f =>
            f.kind === 'image' ? (
              // P10-C parity: the hero photo — the same uploader, writing the
              // content draft (saved with the headline by "Save content").
              <ImageField
                key={f.name}
                id={`sb-${widget.id}-${f.name}`}
                label={f.label}
                siteId={site.id}
                plural={plural}
                orgId={orgId}
                config={{ path: content[f.name] ?? '', alt: content.imageAlt ?? '' }}
                onPatch={patch => setContent(c => ({ ...c, [f.name]: typeof patch.path === 'string' ? patch.path : '' }))}
                showError={showError}
              />
            ) : (
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
            )
          )}
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

// ── Phase 6: the image widget's photo ───────────────────────────────────────
// Upload through the site's own asset route (the SiteBlockEditor recipe:
// validate, measure the intrinsic size client-side, POST, keep the path);
// the server re-asserts the path's site prefix on the next draft save.
function ImageField({
  id,
  label,
  siteId,
  plural,
  orgId,
  config,
  onPatch,
  showError,
}: {
  id: string;
  label: string;
  siteId: string;
  plural: string;
  orgId: string;
  config: Config;
  onPatch: (patch: Config, coalesce?: string) => void;
  showError: (title: string, message?: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const path = str(config, 'path');
  const src = path ? orgMediaUrl(siteId, path) : null;

  const upload = async (file: File | undefined) => {
    if (!file) return;
    const { accepted, rejected } = validateFiles([file], { maxBytes: 10 * 1024 * 1024, allowVideo: false, maxCount: 1 });
    if (rejected.length > 0) {
      showError('Website', rejected[0].message);
      return;
    }
    setUploading(true);
    try {
      const dims = await new Promise<{ width?: number; height?: number }>(resolve => {
        const url = URL.createObjectURL(accepted[0]);
        const probe = new window.Image();
        probe.onload = () => {
          URL.revokeObjectURL(url);
          resolve({ width: probe.naturalWidth || undefined, height: probe.naturalHeight || undefined });
        };
        probe.onerror = () => {
          URL.revokeObjectURL(url);
          resolve({});
        };
        probe.src = url;
      });
      const formData = new FormData();
      formData.append('image', accepted[0]);
      const res = await fetch(`/api/${plural}/${orgId}/site/assets`, { method: 'POST', body: formData });
      const body = (await res.json().catch(() => ({}))) as { path?: string; error?: string };
      if (!res.ok || !body.path) {
        showError('Website', body.error || 'Failed to upload the photo');
        return;
      }
      onPatch({ path: body.path, width: dims.width, height: dims.height });
    } catch {
      showError('Website', 'Upload failed — please try again');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <label className={LABEL} htmlFor={id}>
        {label}
      </label>
      {src ? (
        <Image
          src={src}
          alt={str(config, 'alt')}
          width={typeof config.width === 'number' ? config.width : 1200}
          height={typeof config.height === 'number' ? config.height : 675}
          unoptimized
          className="mb-2 h-auto w-full rounded-md border border-border"
          data-sb-image-preview=""
        />
      ) : (
        <p className="mb-2 text-xs text-tertiary">No photo yet — visitors won’t see this section until it has one.</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label className={`${PILL} inline-flex cursor-pointer items-center`}>
          {uploading ? 'Uploading…' : src ? 'Replace photo' : 'Choose a photo'}
          <input id={id} type="file" accept="image/*" className="sr-only" disabled={uploading} onChange={e => void upload(e.target.files?.[0])} />
        </label>
        {src && (
          <button type="button" className={PILL} onClick={() => onPatch({ path: undefined, width: undefined, height: undefined })}>
            Remove photo
          </button>
        )}
      </div>
    </div>
  );
}

// ── Phase 6: the embed widget's link ────────────────────────────────────────
// The manager pastes a link; the field parses it into a structure and
// commits THAT. What is stored never contains the pasted text.
function EmbedField({ id, spec, config, onPatch }: { id: string; spec: Extract<FieldSpec, { kind: 'embed' }>; config: Config; onPatch: (patch: Config, coalesce?: string) => void }) {
  const [text, setText] = useState('');
  const current = parseEmbed(config.embed);
  const invalid = text.trim().length > 0 && parseEmbedUrl(text) === null;

  return (
    <div>
      <label className={LABEL} htmlFor={id}>
        {spec.label}
      </label>
      <input
        id={id}
        type="url"
        placeholder="https://…"
        value={text}
        onChange={e => {
          const v = e.target.value;
          setText(v);
          const parsed = parseEmbedUrl(v);
          if (parsed) onPatch({ embed: parsed }, `${id}:embed`);
        }}
        className={INPUT}
        aria-describedby={`${id}-status`}
      />
      <p id={`${id}-status`} className={`mt-1 text-xs ${invalid ? 'text-red-600' : 'text-tertiary'}`} data-sb-embed={current?.provider ?? ''}>
        {invalid
          ? 'Not a link we can show — YouTube, Vimeo or OpenStreetMap only.'
          : current
            ? `${EMBED_PROVIDER_LABEL[current.provider]} · ${embedSrc(current).replace(/^https:\/\//, '')}`
            : spec.help}
      </p>
      {current && (
        <button type="button" className={`${PILL} mt-2`} onClick={() => { setText(''); onPatch({ embed: undefined }); }}>
          Remove
        </button>
      )}
    </div>
  );
}
