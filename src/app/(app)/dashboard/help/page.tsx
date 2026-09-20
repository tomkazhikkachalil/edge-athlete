'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import AppHeader from '@/components/AppHeader';
import ConfirmModal from '@/components/ConfirmModal';
import { useDirtyClose } from '@/hooks/useDirtyClose';
import { COPY } from '@/lib/copy';
import { HELP_LIMITS, HELP_TOPICS, HELP_TOPIC_LABELS, slugify, type HelpArticle, type HelpTopic } from '@/lib/help/types';

// The owner's article editor (Support & Reporting, Spec 3): the doc's "Tom
// can add articles from the admin console without a code change". A list
// of every article (drafts marked), one editor form (new or editing), a
// YouTube link field, a publish toggle, delete behind the house confirm.
// Authorization lives in the API (requireAdmin — owner); a 403 renders the
// forbidden state. Unsaved editor text is guarded on Back.

type Draft = { title: string; slug: string; topic: HelpTopic; video_url: string; sort_order: number; published: boolean; body: string };
const EMPTY: Draft = { title: '', slug: '', topic: 'getting_started', video_url: '', sort_order: 100, published: false, body: '' };

export default function HelpArticlesAdminPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [state, setState] = useState<'loading' | 'ready' | 'forbidden' | 'unsupported' | 'error'>('loading');
  const [articles, setArticles] = useState<HelpArticle[]>([]);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const loadRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    if (!loading && !user) router.replace('/');
    if (!user) return;
    let cancelled = false;
    const run = async () => {
      try {
        const res = await fetch('/api/admin/help/articles', { cache: 'no-store' });
        if (cancelled) return;
        if (res.status === 401 || res.status === 403) { setState('forbidden'); return; }
        if (!res.ok) { setState('error'); return; }
        const data = (await res.json()) as { supported: boolean; articles: HelpArticle[] };
        if (cancelled) return;
        setArticles(data.articles);
        setState(data.supported ? 'ready' : 'unsupported');
      } catch {
        if (!cancelled) setState('error');
      }
    };
    loadRef.current = run;
    run();
    return () => { cancelled = true; };
  }, [user, loading, router]);

  const isDirty = useCallback(() => editing !== null && (draft.title.trim() !== '' || draft.body.trim() !== ''), [editing, draft]);
  const { requestClose, confirmOpen, confirmDiscard, cancelDiscard } = useDirtyClose(isDirty, () => router.push('/dashboard'));

  const startNew = () => { setDraft(EMPTY); setEditing('new'); setError(null); };
  const startEdit = (a: HelpArticle) => {
    setDraft({ title: a.title, slug: a.slug, topic: a.topic, video_url: a.video_url ?? '', sort_order: a.sort_order, published: a.published, body: a.body });
    setEditing(a.id);
    setError(null);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = { title: draft.title.trim(), slug: draft.slug.trim() || undefined, topic: draft.topic, video_url: draft.video_url.trim() || null, sort_order: draft.sort_order, published: draft.published, body: draft.body };
      const res = editing === 'new'
        ? await fetch('/api/admin/help/articles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await fetch(`/api/admin/help/articles/${editing}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(typeof data.error === 'string' ? data.error : 'Could not save.'); return; }
      setEditing(null);
      setDraft(EMPTY);
      await loadRef.current();
    } catch {
      setError('Could not save.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setConfirmDelete(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/help/articles/${id}`, { method: 'DELETE' });
      if (!res.ok) setError('Could not delete.');
      if (editing === id) { setEditing(null); setDraft(EMPTY); }
      await loadRef.current();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-canvas">
      <AppHeader showSearch={false} />
      <main className="max-w-3xl mx-auto px-4 py-8">
        <button type="button" onClick={requestClose} className="text-sm text-brand-fg hover:underline mb-4 inline-flex items-center gap-2">
          <i className="fas fa-arrow-left text-xs"></i> Admin
        </button>
        <h1 className="text-2xl font-bold text-primary mb-1">
          <i className="fas fa-book-open mr-2 text-brand-fg"></i>
          Help articles
        </h1>
        <p className="text-sm text-tertiary mb-6">What the Help Center shows. A video is an article with a YouTube link. Drafts are invisible until published.</p>

        {state === 'loading' && <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand mx-auto my-12"></div>}
        {state === 'forbidden' && <p className="text-sm text-tertiary">Owner access required.</p>}
        {state === 'unsupported' && <p className="text-sm text-tertiary">Not available yet — run migration 224.</p>}
        {state === 'error' && <p role="alert" className="text-sm text-tertiary">Couldn&apos;t load the articles.</p>}

        {state === 'ready' && (
          <>
            {editing === null && (
              <button type="button" onClick={startNew} className="mb-4 px-4 py-2 min-h-[44px] rounded-lg bg-brand text-white text-sm font-semibold hover:bg-brand-hover transition" data-help-new="">
                <i className="fas fa-plus mr-2" aria-hidden="true"></i>New article
              </button>
            )}
            {editing !== null && (
              <form className="ea-surface rounded-lg p-4 mb-6 grid gap-3" onSubmit={e => { e.preventDefault(); void save(); }} data-help-editor="">
                <h2 className="text-sm font-semibold text-primary">{editing === 'new' ? 'New article' : 'Edit article'}</h2>
                <label className="text-xs text-muted">
                  Title
                  <input value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value, slug: editing === 'new' && !d.slug ? d.slug : d.slug }))} maxLength={HELP_LIMITS.title} required className="mt-1 block w-full min-h-[44px] rounded-lg border border-border bg-surface px-3 text-sm text-primary" data-help-title="" />
                </label>
                <label className="text-xs text-muted">
                  Slug <span className="text-muted">(the URL; blank = from the title: {draft.title ? slugify(draft.title) || '—' : '—'})</span>
                  <input value={draft.slug} onChange={e => setDraft(d => ({ ...d, slug: e.target.value }))} maxLength={HELP_LIMITS.slug} className="mt-1 block w-full min-h-[44px] rounded-lg border border-border bg-surface px-3 text-sm text-primary font-mono" />
                </label>
                <div className="grid sm:grid-cols-3 gap-3">
                  <label className="text-xs text-muted">
                    Topic
                    <select value={draft.topic} onChange={e => setDraft(d => ({ ...d, topic: e.target.value as HelpTopic }))} className="mt-1 block w-full min-h-[44px] rounded-lg border border-border bg-surface px-2 text-sm text-primary">
                      {HELP_TOPICS.map(t => <option key={t} value={t}>{HELP_TOPIC_LABELS[t]}</option>)}
                    </select>
                  </label>
                  <label className="text-xs text-muted">
                    Order <span className="text-muted">(low first)</span>
                    <input type="number" min={0} max={10000} value={draft.sort_order} onChange={e => setDraft(d => ({ ...d, sort_order: Number(e.target.value) || 0 }))} className="mt-1 block w-full min-h-[44px] rounded-lg border border-border bg-surface px-3 text-sm text-primary" />
                  </label>
                  <label className="text-xs text-muted inline-flex items-end gap-2 pb-3">
                    <input type="checkbox" checked={draft.published} onChange={e => setDraft(d => ({ ...d, published: e.target.checked }))} data-help-published="" />
                    Published
                  </label>
                </div>
                <label className="text-xs text-muted">
                  YouTube link <span className="text-muted">(optional — makes it a how-to video)</span>
                  <input value={draft.video_url} onChange={e => setDraft(d => ({ ...d, video_url: e.target.value }))} placeholder="https://www.youtube.com/watch?v=…" className="mt-1 block w-full min-h-[44px] rounded-lg border border-border bg-surface px-3 text-sm text-primary" data-help-video-url="" />
                </label>
                <label className="text-xs text-muted">
                  Body <span className="text-muted">(plain text: blank line = a paragraph, &quot;- &quot; = a bullet, &quot;## &quot; = a heading)</span>
                  <textarea value={draft.body} onChange={e => setDraft(d => ({ ...d, body: e.target.value }))} maxLength={HELP_LIMITS.body} rows={10} className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-primary font-mono" data-help-body-input="" />
                </label>
                {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
                <div className="flex flex-wrap gap-2">
                  <button type="submit" disabled={busy || !draft.title.trim()} className="px-4 py-2 min-h-[44px] rounded-lg bg-brand text-white text-sm font-semibold hover:bg-brand-hover transition disabled:opacity-50" data-help-save="">
                    {busy ? 'Saving…' : 'Save'}
                  </button>
                  <button type="button" disabled={busy} onClick={() => { setEditing(null); setDraft(EMPTY); setError(null); }} className="px-4 py-2 min-h-[44px] rounded-lg border border-border bg-surface text-sm font-semibold text-primary ea-interactive">
                    Cancel
                  </button>
                  {editing !== 'new' && (
                    <button type="button" disabled={busy} onClick={() => setConfirmDelete(editing)} className="px-4 py-2 min-h-[44px] rounded-lg border border-border bg-surface text-sm font-semibold text-red-600 dark:text-red-400 ea-interactive ml-auto" data-help-delete="">
                      Delete
                    </button>
                  )}
                </div>
              </form>
            )}

            {articles.length === 0 ? (
              <p className="text-sm text-muted bg-surface border border-border rounded-lg p-6 text-center">No articles yet.</p>
            ) : (
              <ul className="space-y-2" data-help-admin-list="">
                {articles.map(a => (
                  <li key={a.id}>
                    <button type="button" onClick={() => startEdit(a)} className="w-full text-left ea-surface ea-surface-raised rounded-lg p-4 ea-interactive" data-help-admin-row={a.slug}>
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${a.published ? 'bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300' : 'bg-surface-muted text-muted'}`}>{a.published ? 'Published' : 'Draft'}</span>
                        <span className="text-xs text-muted">{HELP_TOPIC_LABELS[a.topic]} · #{a.sort_order}</span>
                        {a.video_url && <i className="fas fa-circle-play text-brand-fg text-xs" aria-label="Has a video"></i>}
                      </div>
                      <p className="text-sm font-semibold text-primary">{a.title}</p>
                      <p className="text-xs text-muted font-mono">/help/{a.slug}</p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </main>

      <ConfirmModal
        isOpen={confirmDelete !== null}
        title="Delete this article?"
        message="It disappears from the Help Center. This can't be undone."
        confirmText="Delete"
        cancelText="Keep it"
        onConfirm={() => { if (confirmDelete) void remove(confirmDelete); }}
        onCancel={() => setConfirmDelete(null)}
      />
      <ConfirmModal
        isOpen={confirmOpen}
        title={COPY.FORMS.DISCARD_TITLE}
        message={COPY.FORMS.DISCARD_CONFIRM}
        confirmText={COPY.FORMS.DISCARD_ACTION}
        cancelText={COPY.FORMS.KEEP_EDITING}
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
    </div>
  );
}
