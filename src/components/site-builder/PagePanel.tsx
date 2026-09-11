'use client';

import { useState } from 'react';
import LargerWindow from '@/components/bubbles/LargerWindow';
import ConfirmModal from '@/components/ConfirmModal';
import type { CanvasPage } from '@/lib/org-sites/canvas-server';

// ── A page's settings — program 2, B3 (Sep 11 2026) ──────────────────────
// Title, address, published, shown in the header, delete. Every write is a
// site PATCH (`set_page` / `remove_page`) into the DRAFT; the editor reloads
// afterwards so the header's page list and the address are the server's.
// Hosted by a LargerWindow at every width (a bottom sheet on a phone).

interface Props {
  page: CanvasPage;
  plural: string;
  orgId: string;
  onClose: () => void;
  /** After a saved change (title / address / published / header): reload, same page. */
  onSaved: () => void;
  /** After the page is deleted: reload on the home. */
  onDeleted: () => void;
  showError: (title: string, message?: string) => void;
  showSuccess: (title: string, message?: string) => void;
}

const LABEL = 'mb-1 block text-xs font-medium text-secondary';
const INPUT = 'w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-primary min-h-[44px]';
const PILL = 'min-h-[44px] rounded-md border border-border-strong px-3 text-sm text-secondary hover:bg-surface-sunken transition-colors disabled:opacity-50';
const CTA = 'min-h-[44px] rounded-md bg-brand px-3 text-sm font-medium text-white hover:bg-brand-hover transition-colors disabled:opacity-50';

export default function PagePanel({ page, plural, orgId, onClose, onSaved, onDeleted, showError, showSuccess }: Props) {
  const [title, setTitle] = useState(page.title);
  const [slug, setSlug] = useState(page.slug);
  const [visibility, setVisibility] = useState<'public' | 'draft'>(page.visibility);
  const [inNav, setInNav] = useState(page.inNav);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dirty = title.trim() !== page.title || slug.trim() !== page.slug || visibility !== page.visibility || inNav !== page.inNav;

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/${plural}/${orgId}/site`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'set_page',
          pageId: page.id,
          ...(title.trim() !== page.title ? { title: title.trim() } : {}),
          ...(slug.trim() !== page.slug ? { slug: slug.trim() } : {}),
          ...(visibility !== page.visibility ? { visibility } : {}),
          ...(inNav !== page.inNav ? { inNav } : {}),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        showError('Website', body.error || 'Could not save the page');
        return;
      }
      showSuccess('Website', 'Page saved to your draft');
      onSaved();
    } catch {
      showError('Website', 'Could not save the page');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/${plural}/${orgId}/site`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove_page', pageId: page.id }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        showError('Website', body.error || 'Could not delete the page');
        return;
      }
      showSuccess('Website', 'Page removed from your draft');
      onDeleted();
    } catch {
      showError('Website', 'Could not delete the page');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <LargerWindow title="Page settings" subtitle="Saved to your draft — nothing changes on your site until you publish." windowKey="sb-page" onClose={onClose}>
        <form
          className="space-y-4"
          data-sb-page-panel={page.id}
          onSubmit={e => {
            e.preventDefault();
            if (dirty && !saving) void save();
          }}
        >
          <div>
            <label className={LABEL} htmlFor="sb-page-title">
              Page title
            </label>
            <input id="sb-page-title" type="text" value={title} maxLength={120} onChange={e => setTitle(e.target.value)} className={INPUT} required />
          </div>
          <div>
            <label className={LABEL} htmlFor="sb-page-slug">
              Address
            </label>
            <input id="sb-page-slug" type="text" value={slug} maxLength={80} onChange={e => setSlug(e.target.value.toLowerCase())} className={INPUT} required pattern="[a-z0-9][a-z0-9-]*[a-z0-9]?" />
            <p className="mt-1 text-xs text-tertiary">Letters, numbers and dashes. The page lives at /{slug || '…'} on your site.</p>
          </div>
          <div>
            <label className={LABEL} htmlFor="sb-page-visibility">
              Published
            </label>
            <select id="sb-page-visibility" value={visibility} onChange={e => setVisibility(e.target.value === 'public' ? 'public' : 'draft')} className={INPUT}>
              <option value="draft">Not yet — a draft nobody can open</option>
              <option value="public">Yes — visitors can open it</option>
            </select>
          </div>
          <label className="flex min-h-[44px] items-center gap-2 text-sm text-primary">
            <input type="checkbox" checked={inNav} onChange={e => setInNav(e.target.checked)} className="h-4 w-4" />
            Show in the site header
          </label>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
            <button type="button" onClick={() => setConfirmDelete(true)} disabled={saving} className={`${PILL} text-red-600`} data-sb-page-delete="">
              Delete page
            </button>
            <button type="submit" disabled={!dirty || saving} className={CTA} data-sb-page-save="">
              {saving ? 'Saving…' : 'Save page'}
            </button>
          </div>
        </form>
      </LargerWindow>
      <ConfirmModal
        isOpen={confirmDelete}
        title="Delete this page?"
        message="Its sections go with it. Nothing changes on your site until you publish; History keeps the published version."
        confirmText="Delete"
        onConfirm={() => {
          setConfirmDelete(false);
          void remove();
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}
