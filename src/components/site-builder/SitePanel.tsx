'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import type { PublicSite } from '@/lib/org-sites/server';
import { orgMediaUrl } from '@/lib/media/org-site-media';
import { validateFiles } from '@/lib/media/validation';
import {
  FOOTER_LINKS_MAX,
  FOOTER_LINK_LABEL_MAX,
  FOOTER_TEXT_MAX,
  SEO_DESCRIPTION_MAX,
  SEO_TITLE_MAX,
  parseFooterConfig,
  parseSeoConfig,
  parseThemeTokens,
} from '@/lib/org-sites/validate';

// ── Site settings — program 2, C2 (Sep 11 2026) ──────────────────────────
// How the site presents itself: the SEO title, description and social
// image; the footer line, links and socials; the site icon. Every field is
// a draft write through the site's own actions (`set_seo`, `set_footer`,
// `set_theme` for the icon — the same token set the theme panel saves, so
// nothing else in it moves) followed by the editor's refresh. An aside
// beside the canvas above lg, a bottom sheet below (the A1 pattern).

export interface SitePanelProps {
  site: PublicSite;
  plural: string;
  orgId: string;
  variant?: 'aside' | 'sheet';
  className?: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
  showError: (title: string, message?: string) => void;
  showSuccess: (title: string, message?: string) => void;
}

const INPUT = 'w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-primary';
const LABEL = 'block text-xs font-medium text-secondary mb-1';
const PILL = 'px-3 py-1.5 text-sm min-h-[36px] rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors disabled:opacity-50';
const CTA = 'px-3 py-1.5 text-sm min-h-[36px] rounded-md bg-brand text-white font-medium hover:bg-brand-hover transition-colors disabled:opacity-50';

type FooterLink = { label: string; url: string };

export default function SitePanel({ site, plural, orgId, variant = 'aside', className, onClose, onSaved, onDirtyChange, showError, showSuccess }: SitePanelProps) {
  const seo0 = parseSeoConfig(site.seo_config);
  const footer0 = parseFooterConfig(site.footer_config);
  const icon0 = parseThemeTokens(site.theme_token_set).iconPath;
  const [title, setTitle] = useState(seo0.title ?? '');
  const [description, setDescription] = useState(seo0.description ?? '');
  const [imagePath, setImagePath] = useState<string | null>(seo0.imagePath);
  const [text, setText] = useState(footer0.text ?? '');
  const [links, setLinks] = useState<FooterLink[]>(footer0.links);
  const [showSocials, setShowSocials] = useState(footer0.showSocials);
  const [iconPath, setIconPath] = useState<string | null>(icon0);
  const [saving, setSaving] = useState(false);

  const cleanLinks = links.map(l => ({ label: l.label.trim(), url: l.url.trim() })).filter(l => l.label && l.url);
  const dirty =
    title.trim() !== (seo0.title ?? '') ||
    description.trim() !== (seo0.description ?? '') ||
    imagePath !== seo0.imagePath ||
    text.trim() !== (footer0.text ?? '') ||
    JSON.stringify(cleanLinks) !== JSON.stringify(footer0.links) ||
    showSocials !== footer0.showSocials ||
    iconPath !== icon0;
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  const patch = async (body: Record<string, unknown>) => {
    const res = await fetch(`/api/${plural}/${orgId}/site`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error || 'Could not save');
    }
  };
  const save = async () => {
    setSaving(true);
    try {
      await patch({ action: 'set_seo', ...(title.trim() ? { title: title.trim() } : {}), ...(description.trim() ? { description: description.trim() } : {}), ...(imagePath ? { imagePath } : {}) });
      await patch({ action: 'set_footer', ...(text.trim() ? { text: text.trim() } : {}), links: cleanLinks, showSocials });
      if (iconPath !== icon0) {
        // The icon rides the theme token set: send the tokens as they are
        // (the design keys carry over on the server) plus the icon.
        const t = parseThemeTokens(site.theme_token_set);
        await patch({ action: 'set_theme', accent: t.accent, accentStrong: t.accentStrong, surface: t.surface, typeface: t.typeface, ...(t.wordmark ? { wordmark: t.wordmark } : {}), iconPath });
      }
      await onSaved();
      showSuccess('Website', 'Site settings saved to your draft');
    } catch (e) {
      showError('Website', e instanceof Error ? e.message : 'Could not save the site settings');
    } finally {
      setSaving(false);
    }
  };

  const setLink = (i: number, next: Partial<FooterLink>) => setLinks(prev => prev.map((l, j) => (j === i ? { ...l, ...next } : l)));

  return (
    <aside tabIndex={-1} className={`${variant === 'sheet' ? 'w-full pb-4' : 'w-80 shrink-0 rounded-xl border border-border bg-surface p-4'} space-y-4 outline-none ${className ?? ''}`} aria-label="Site settings" data-sb-settings-panel="" data-sb-panel-variant={variant}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">Site</p>
          <h2 className="text-base font-semibold text-primary">Settings</h2>
        </div>
        {variant === 'aside' && (
          <button type="button" onClick={onClose} className="ea-icon-btn inline-flex h-8 w-8 items-center justify-center rounded-md text-muted hover:text-primary hover:bg-surface-sunken" aria-label="Close site settings">
            ×
          </button>
        )}
      </div>

      <fieldset className="space-y-3">
        <legend className="text-xs font-medium text-secondary">Search and sharing</legend>
        <div>
          <label className={LABEL} htmlFor="sb-seo-title">
            Site title
          </label>
          <input id="sb-seo-title" type="text" value={title} maxLength={SEO_TITLE_MAX} placeholder={site.orgName} onChange={e => setTitle(e.target.value)} className={INPUT} />
          <p className="mt-1 text-xs text-tertiary">The browser tab and search result title. Blank = your organization’s name.</p>
        </div>
        <div>
          <label className={LABEL} htmlFor="sb-seo-description">
            Description
          </label>
          <textarea id="sb-seo-description" rows={3} value={description} maxLength={SEO_DESCRIPTION_MAX} onChange={e => setDescription(e.target.value)} className={INPUT} />
          <p className="mt-1 text-xs text-tertiary">One or two sentences for search results and shared links ({SEO_DESCRIPTION_MAX} characters).</p>
        </div>
        <AssetPicker id="sb-seo-image" label="Sharing image" hint="Shown when your site is shared. Blank = a card with your name and colours." path={imagePath} plural={plural} orgId={orgId} siteId={site.id} onChange={setImagePath} showError={showError} />
      </fieldset>

      <fieldset className="space-y-3 border-t border-border pt-4">
        <legend className="text-xs font-medium text-secondary">Footer</legend>
        <div>
          <label className={LABEL} htmlFor="sb-footer-text">
            Footer line
          </label>
          <input id="sb-footer-text" type="text" value={text} maxLength={FOOTER_TEXT_MAX} onChange={e => setText(e.target.value)} className={INPUT} placeholder="Est. 1962 · Members and guests welcome" />
        </div>
        <div className="space-y-2">
          <p className={LABEL}>Links</p>
          {links.map((l, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2" data-sb-footer-link={i}>
              <input type="text" value={l.label} maxLength={FOOTER_LINK_LABEL_MAX} aria-label={`Link ${i + 1} label`} placeholder="Label" onChange={e => setLink(i, { label: e.target.value })} className={`${INPUT} min-w-0 flex-1`} />
              <input type="url" value={l.url} maxLength={200} aria-label={`Link ${i + 1} URL`} placeholder="https://…" onChange={e => setLink(i, { url: e.target.value })} className={`${INPUT} min-w-0 flex-[2]`} />
              <button type="button" onClick={() => setLinks(prev => prev.filter((_, j) => j !== i))} className={PILL} aria-label={`Remove link ${i + 1}`}>
                ×
              </button>
            </div>
          ))}
          {links.length < FOOTER_LINKS_MAX && (
            <button type="button" onClick={() => setLinks(prev => [...prev, { label: '', url: '' }])} className={PILL} data-sb-footer-add-link="">
              + Link
            </button>
          )}
        </div>
        <label className="flex min-h-[36px] items-center gap-2 text-sm text-primary">
          <input type="checkbox" checked={showSocials} onChange={e => setShowSocials(e.target.checked)} className="h-4 w-4" />
          Show social links
        </label>
        <p className="text-xs text-tertiary">The links from your contact card. “Powered by Edge Athlete” stays on every site.</p>
      </fieldset>

      <fieldset className="space-y-3 border-t border-border pt-4">
        <legend className="text-xs font-medium text-secondary">Site icon</legend>
        <AssetPicker id="sb-site-icon" label="Icon" hint="A square image for the browser tab. Blank = your logo, else a letter in your colours." path={iconPath} plural={plural} orgId={orgId} siteId={site.id} onChange={setIconPath} showError={showError} square />
      </fieldset>

      <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
        <button type="button" onClick={() => void save()} disabled={!dirty || saving} className={CTA} data-sb-settings-save="">
          {saving ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </aside>
  );
}

/** One site asset: choose / replace / remove through the site's assets route. */
function AssetPicker({ id, label, hint, path, plural, orgId, siteId, onChange, showError, square }: { id: string; label: string; hint: string; path: string | null; plural: string; orgId: string; siteId: string; onChange: (path: string | null) => void; showError: (title: string, message?: string) => void; square?: boolean }) {
  const [uploading, setUploading] = useState(false);
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
      const formData = new FormData();
      formData.append('image', accepted[0]);
      const res = await fetch(`/api/${plural}/${orgId}/site/assets`, { method: 'POST', body: formData });
      const body = (await res.json().catch(() => ({}))) as { path?: string; error?: string };
      if (!res.ok || !body.path) {
        showError('Website', body.error || 'Failed to upload the image');
        return;
      }
      onChange(body.path);
    } catch {
      showError('Website', 'Upload failed — please try again');
    } finally {
      setUploading(false);
    }
  };
  return (
    <div>
      <p className={LABEL} id={`${id}-heading`}>
        {label}
      </p>
      {src ? (
        <Image src={src} alt="" width={square ? 64 : 1200} height={square ? 64 : 630} unoptimized className={`mb-2 rounded-md border border-border ${square ? 'h-16 w-16' : 'h-auto w-full'}`} data-sb-asset-preview={id} />
      ) : (
        <p className="mb-2 text-xs text-tertiary">{hint}</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label className={`${PILL} inline-flex cursor-pointer items-center`} htmlFor={id}>
          {uploading ? 'Uploading…' : src ? 'Replace image' : 'Choose an image'}
          <input id={id} type="file" accept="image/*" className="sr-only" disabled={uploading} aria-describedby={`${id}-heading`} onChange={e => void upload(e.target.files?.[0])} />
        </label>
        {src && (
          <button type="button" className={PILL} onClick={() => onChange(null)}>
            Remove
          </button>
        )}
      </div>
    </div>
  );
}
