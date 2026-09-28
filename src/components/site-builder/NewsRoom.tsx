'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import ConfirmModal from '@/components/ConfirmModal';
import { validateFiles } from '@/lib/media/validation';
import { newsState } from '@/lib/org-sites/news-state';
import { composerValues, groupNews, hasPendingDraft, stateLine, type ComposerValues, type NewsRow } from '@/lib/org-sites/news-room';
import { PAGE_BODY_MAX_BLOCKS } from '@/lib/org-sites/validate';
import AssetPicker from './AssetPicker';
import BlocksField, { readTextBlocks, type TextBlock } from './BlocksField';

/**
 * The newsroom — sports-team website program, N4 (Sep 27 2026). News is
 * written INSIDE the site editor now (one home): a list (drafts, scheduled,
 * live, "New post") and a composer in the same window. ONE save model
 * (N3, news-state.ts): the composer autosaves every change as an `edit`
 * with the `updated_at` it last saw — the server writes an unpublished
 * post's columns, or a LIVE post's draft (the site never shows half-typed
 * text) until Update. A stale save answers 409 with the latest, which the
 * composer loads. Publish / Schedule / Update / Unpublish flush first.
 */

const INPUT = 'w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-primary';
const LABEL = 'block text-xs font-medium text-secondary mb-1';
const PILL = 'px-3 py-1.5 text-sm min-h-[36px] rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors disabled:opacity-50';
const CTA = 'px-3 py-1.5 text-sm min-h-[36px] rounded-md bg-brand text-white font-medium hover:bg-brand-hover transition-colors disabled:opacity-50';
const AUTOSAVE_MS = 800;

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
interface TagOption {
  value: string; // 'team:<id>' | 'division:<id>'
  label: string;
}

export interface NewsRoomProps {
  plural: string;
  orgId: string;
  siteId: string;
  /** 'list', 'new', or a post id (the ?news= deep link). */
  initial: string;
  showError: (title: string, message?: string) => void;
  showSuccess: (title: string, message?: string) => void;
}

export default function NewsRoom({ plural, orgId, siteId, initial, showError, showSuccess }: NewsRoomProps) {
  const [openId, setOpenId] = useState<string | null>(initial !== 'list' && initial !== 'new' ? initial : null);
  const [creating, setCreating] = useState(false);
  const created = useRef(false);
  const base = `/api/${plural}/${orgId}/site/news`;

  const createPost = useCallback(async () => {
    setCreating(true);
    try {
      const res = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'New post' }) });
      const body = (await res.json().catch(() => ({}))) as { post?: { id: string }; error?: string };
      if (!res.ok || !body.post) {
        showError('News', body.error || 'Could not start a post');
        return;
      }
      setOpenId(body.post.id);
    } finally {
      setCreating(false);
    }
  }, [base, showError]);

  // ?news=new: start a post once (a ref guard — never two posts for one link).
  useEffect(() => {
    if (initial !== 'new' || created.current) return;
    created.current = true;
    const t = setTimeout(() => void createPost(), 0);
    return () => clearTimeout(t);
  }, [initial, createPost]);

  return openId ? (
    <Composer key={openId} id={openId} base={base} plural={plural} orgId={orgId} siteId={siteId} onBack={() => setOpenId(null)} showError={showError} showSuccess={showSuccess} />
  ) : (
    <NewsList base={base} creating={creating} onOpen={setOpenId} onNew={() => void createPost()} showError={showError} />
  );
}

function NewsList({ base, creating, onOpen, onNew, showError }: { base: string; creating: boolean; onOpen: (id: string) => void; onNew: () => void; showError: (title: string, message?: string) => void }) {
  const [rows, setRows] = useState<NewsRow[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(base);
        const body = (await res.json().catch(() => ({}))) as { posts?: NewsRow[]; error?: string };
        if (cancelled) return;
        if (!res.ok) {
          showError('News', body.error || 'Could not load the news');
          setRows([]);
          return;
        }
        setRows(body.posts ?? []);
      } catch {
        if (!cancelled) setRows([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [base, showError]);

  // The clock is read once per mount (react-hooks/purity: never Date.now() in render).
  const [now] = useState(() => Date.now());
  const groups = groupNews(rows ?? [], now);
  const section = (title: string, list: NewsRow[], key: string) =>
    list.length > 0 && (
      <section className="space-y-1" data-sb-news-group={key}>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-tertiary">{title}</h3>
        <ul className="divide-y divide-border-subtle rounded-lg border border-border">
          {list.map(r => (
            <li key={r.id}>
              <button type="button" onClick={() => onOpen(r.id)} className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-surface-sunken" data-sb-news-row={r.id}>
                <span className="min-w-0 truncate text-sm font-medium text-primary">{r.title}</span>
                <span className="shrink-0 text-xs text-tertiary">
                  {key === 'scheduled' && r.published_at ? new Date(r.published_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : key === 'live' && hasPendingDraft(r, now) ? 'Changes waiting' : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    );

  return (
    <div className="space-y-4" data-sb-news-list="">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-secondary">Write news for your site. Posts save as you type.</p>
        <button type="button" onClick={onNew} disabled={creating} className={CTA} data-sb-news-new="">
          {creating ? 'Starting…' : '+ New post'}
        </button>
      </div>
      {rows === null ? (
        <p className="text-sm text-tertiary">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-tertiary">No news yet — start your first post.</p>
      ) : (
        <>
          {section('Drafts', groups.drafts, 'drafts')}
          {section('Scheduled', groups.scheduled, 'scheduled')}
          {section('Live', groups.live, 'live')}
        </>
      )}
    </div>
  );
}

function Composer({
  id,
  base,
  plural,
  orgId,
  siteId,
  onBack,
  showError,
  showSuccess,
}: {
  id: string;
  base: string;
  plural: string;
  orgId: string;
  siteId: string;
  onBack: () => void;
  showError: (title: string, message?: string) => void;
  showSuccess: (title: string, message?: string) => void;
}) {
  const url = `${base}/${id}`;
  const [post, setPost] = useState<NewsRow | null>(null);
  const [values, setValues] = useState<ComposerValues | null>(null);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [busy, setBusy] = useState(false);
  const [scheduleAt, setScheduleAt] = useState('');
  const [tags, setTags] = useState<TagOption[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // The clock the state reads against — refreshed whenever a post is adopted
  // (a publish or a schedule), never read during render (react-hooks/purity).
  const [nowMs, setNowMs] = useState(() => Date.now());
  // The autosave: one edit accumulates, one save in flight, the last seen updated_at.
  const pending = useRef<Record<string, unknown>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const seen = useRef<string | undefined>(undefined);

  const adopt = useCallback((row: NewsRow, resetForm: boolean) => {
    setPost(row);
    setNowMs(Date.now());
    seen.current = row.updated_at;
    if (resetForm) setValues(composerValues(row));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [postRes, structRes] = await Promise.all([fetch(url), fetch(`/api/${plural}/${orgId}/structure`)]);
        const body = (await postRes.json().catch(() => ({}))) as { post?: NewsRow; error?: string };
        if (cancelled) return;
        if (!postRes.ok || !body.post) {
          showError('News', body.error || 'Could not open the post');
          onBack();
          return;
        }
        adopt(body.post, true);
        if (structRes.ok) {
          const s = (await structRes.json().catch(() => ({}))) as { teams?: { id: string; name: string }[]; seasons?: { label?: string; divisions?: { id: string; name: string }[] }[] };
          if (cancelled) return;
          setTags([
            ...(s.teams ?? []).map(t => ({ value: `team:${t.id}`, label: `Team · ${t.name}` })),
            ...(s.seasons ?? []).flatMap(season => (season.divisions ?? []).map(d => ({ value: `division:${d.id}`, label: `Division · ${d.name}${season.label ? ` (${season.label})` : ''}` }))),
          ]);
        }
      } catch {
        if (!cancelled) showError('News', 'Could not open the post');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, plural, orgId, adopt, onBack, showError]);

  // One save in flight; edits typed meanwhile accumulate and go out next —
  // a loop that drains `pending` (a callback may not call itself).
  const saveNow = useCallback(async (): Promise<void> => {
    if (inFlight.current) await inFlight.current;
    while (Object.keys(pending.current).length > 0) {
      const edit = pending.current;
      pending.current = {};
      setStatus('saving');
      let stop = false;
      const run = (async () => {
        try {
          const res = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ edit, expectUpdatedAt: seen.current }) });
          const body = (await res.json().catch(() => ({}))) as { post?: NewsRow; error?: string; code?: string };
          if (res.status === 409 && body.post) {
            // Someone saved in between: load theirs (never overwrite it).
            pending.current = {};
            adopt(body.post, true);
            setStatus('saved');
            showError('News', 'This post changed somewhere else — the latest is loaded.');
            stop = true;
            return;
          }
          if (!res.ok || !body.post) {
            pending.current = { ...edit, ...pending.current };
            setStatus('error');
            showError('News', body.error || 'Could not save — your text is kept here; it retries on the next change.');
            stop = true;
            return;
          }
          adopt(body.post, false);
          setStatus(Object.keys(pending.current).length > 0 ? 'saving' : 'saved');
        } catch {
          pending.current = { ...edit, ...pending.current };
          setStatus('error');
          stop = true;
        }
      })();
      inFlight.current = run;
      await run;
      inFlight.current = null;
      if (stop) return;
    }
  }, [url, adopt, showError]);

  const change = (patch: Partial<ComposerValues>, edit: Record<string, unknown>) => {
    setValues(v => (v ? { ...v, ...patch } : v));
    pending.current = { ...pending.current, ...edit };
    setStatus('saving');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void saveNow(), AUTOSAVE_MS);
  };
  const flush = async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    await saveNow();
  };
  // Closing the window with a save still waiting must not drop it: the
  // pending edit goes out as a keepalive request (it outlives the unmount).
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      const edit = pending.current;
      if (Object.keys(edit).length === 0) return;
      pending.current = {};
      void fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ edit, expectUpdatedAt: seen.current }),
        keepalive: true,
      }).catch(() => {});
    },
    [url]
  );

  const act = async (body: Record<string, unknown>, ok: string) => {
    setBusy(true);
    try {
      await flush();
      const res = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = (await res.json().catch(() => ({}))) as { post?: NewsRow; error?: string };
      if (!res.ok || !json.post) {
        showError('News', json.error || 'Could not do that');
        return;
      }
      adopt(json.post, true);
      showSuccess('News', ok);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setConfirmDelete(false);
    setBusy(true);
    try {
      if (timer.current) clearTimeout(timer.current);
      const res = await fetch(url, { method: 'DELETE' });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        showError('News', json.error || 'Could not delete the post');
        return;
      }
      showSuccess('News', 'Post deleted — it can be restored from the console for 30 days');
      onBack();
    } finally {
      setBusy(false);
    }
  };
  const uploadPhoto = async (file: File) => {
    const { accepted, rejected } = validateFiles([file], { maxBytes: 10 * 1024 * 1024, allowVideo: false, maxCount: 1 });
    if (rejected.length > 0) {
      showError('News', rejected[0].message);
      return null;
    }
    const dims = await new Promise<{ width?: number; height?: number }>(resolve => {
      const src = URL.createObjectURL(accepted[0]);
      const probe = new window.Image();
      probe.onload = () => {
        URL.revokeObjectURL(src);
        resolve({ width: probe.naturalWidth || undefined, height: probe.naturalHeight || undefined });
      };
      probe.onerror = () => {
        URL.revokeObjectURL(src);
        resolve({});
      };
      probe.src = src;
    });
    const formData = new FormData();
    formData.append('image', accepted[0]);
    const res = await fetch(`/api/${plural}/${orgId}/site/assets`, { method: 'POST', body: formData });
    const body = (await res.json().catch(() => ({}))) as { path?: string; error?: string };
    if (!res.ok || !body.path) {
      showError('News', body.error || 'Could not upload the photo');
      return null;
    }
    return { path: body.path, ...dims };
  };

  if (!post || !values) return <p className="text-sm text-tertiary">Loading the post…</p>;
  const state = newsState(post.published_at, nowMs);
  const pendingDraft = hasPendingDraft(post, nowMs);
  const tagValue = values.teamId ? `team:${values.teamId}` : values.divisionId ? `division:${values.divisionId}` : '';
  const chip = status === 'saving' ? 'Saving…' : status === 'error' ? 'Not saved' : status === 'saved' ? 'Saved' : '';

  return (
    <div className="space-y-4" data-sb-news-composer={id} data-sb-news-state={state}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={() => void flush().then(onBack)} className={PILL}>
          ← All news
        </button>
        <span className="text-xs text-tertiary" data-sb-news-save={status} aria-live="polite">
          {chip}
        </span>
      </div>
      <p className="rounded-md bg-surface-sunken px-3 py-2 text-sm text-secondary" data-sb-news-line="">
        {stateLine(state, post.published_at, pendingDraft)}
      </p>

      <div>
        <label className={LABEL} htmlFor={`news-${id}-title`}>
          Title
        </label>
        <input id={`news-${id}-title`} type="text" maxLength={120} value={values.title} onChange={e => change({ title: e.target.value }, { title: e.target.value.trim() || 'Untitled post' })} className={INPUT} />
      </div>
      <div>
        <label className={LABEL} htmlFor={`news-${id}-summary`}>
          Summary
        </label>
        <textarea id={`news-${id}-summary`} rows={2} maxLength={280} value={values.summary} onChange={e => change({ summary: e.target.value }, { summary: e.target.value.trim() ? e.target.value : null })} className={INPUT} placeholder="One or two lines for the news card." />
      </div>
      <AssetPicker
        id={`news-${id}-cover`}
        label="Cover photo"
        hint="Shown on the news card and when the post is shared. Blank = the first photo in the post."
        path={values.coverPath}
        plural={plural}
        orgId={orgId}
        siteId={siteId}
        onChange={path => change({ coverPath: path }, { coverPath: path })}
        showError={showError}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={LABEL} htmlFor={`news-${id}-tag`}>
            Team or division
          </label>
          <select
            id={`news-${id}-tag`}
            value={tagValue}
            onChange={e => {
              const [kind, tagId] = e.target.value.split(':');
              const teamId = kind === 'team' ? tagId : null;
              const divisionId = kind === 'division' ? tagId : null;
              change({ teamId, divisionId }, { teamId, divisionId });
            }}
            className={INPUT}
          >
            <option value="">The whole club</option>
            {tags.map(t => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          {/* Audience and pin are the post's SETTINGS — they act at once (the
              old editor's behaviour), never through a live post's draft. */}
          <label className={LABEL} htmlFor={`news-${id}-audience`}>
            Who can read it
          </label>
          <select
            id={`news-${id}-audience`}
            aria-label="Post audience"
            value={post.audience === 'members' ? 'members' : 'public'}
            disabled={busy}
            onChange={e => {
              const next = e.target.value === 'members' ? 'members' : 'public';
              void act({ audience: next }, next === 'members' ? 'Members only — hidden on a private club’s site' : 'Public — shown on the site');
            }}
            className={INPUT}
          >
            <option value="public">Everyone</option>
            <option value="members">Members only</option>
          </select>
        </div>
      </div>
      <button
        type="button"
        aria-pressed={!!post.pinned_at}
        disabled={busy}
        onClick={() => void act({ pinned: !post.pinned_at }, post.pinned_at ? 'Unpinned' : 'Pinned to the top of your news')}
        className={PILL}
        data-news-pin=""
      >
        {post.pinned_at ? 'Pinned to the top — unpin' : 'Pin to the top of the news'}
      </button>
      <div>
        <p className={LABEL}>The post</p>
        <BlocksField
          idBase={`news-${id}`}
          blocks={readTextBlocks(values.body)}
          max={PAGE_BODY_MAX_BLOCKS}
          photos={{ siteId, store: uploadPhoto }}
          onChange={(blocks: TextBlock[]) => change({ body: blocks }, { body: blocks })}
        />
      </div>

      {/* The acts stay in reach on a long post: the bar sticks to the window's bottom. */}
      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-2 border-t border-border bg-surface px-1 py-3" data-sb-news-actions="">
        {state === 'live' ? (
          <>
            <button type="button" className={CTA} disabled={busy || (!pendingDraft && status !== 'saving')} onClick={() => void act({ promote: true }, 'Your changes are live')} data-sb-news-update="">
              Update
            </button>
            <button type="button" className={PILL} disabled={busy} onClick={() => void act({ publish: false }, 'Post unpublished')}>
              Unpublish
            </button>
          </>
        ) : (
          <>
            <button type="button" className={CTA} disabled={busy} onClick={() => void act({ publish: true }, 'Post is live')} data-sb-news-publish="">
              Publish now
            </button>
            <label className="flex items-center gap-2 text-xs text-secondary">
              <span className="sr-only">Publish at</span>
              <input type="datetime-local" value={scheduleAt} onChange={e => setScheduleAt(e.target.value)} className={`${INPUT} w-auto`} aria-label="Publish at" data-sb-news-when="" />
            </label>
            <button
              type="button"
              className={PILL}
              disabled={busy || !scheduleAt}
              onClick={() => {
                const at = new Date(scheduleAt);
                if (!Number.isFinite(at.getTime()) || at.getTime() <= Date.now()) {
                  showError('News', 'Pick a time in the future (or press Publish now).');
                  return;
                }
                void act({ publishAt: at.toISOString() }, 'Post scheduled');
              }}
              data-sb-news-schedule=""
            >
              {state === 'scheduled' ? 'Change time' : 'Schedule'}
            </button>
            {state === 'scheduled' && (
              <button type="button" className={PILL} disabled={busy} onClick={() => void act({ publish: false }, 'Back to draft')}>
                Unschedule
              </button>
            )}
          </>
        )}
        <button type="button" className={`${PILL} ml-auto`} disabled={busy} onClick={() => setConfirmDelete(true)}>
          Delete
        </button>
      </div>
      <ConfirmModal
        isOpen={confirmDelete}
        title="Delete this post?"
        message="It comes off your site straight away. It can be restored from the console for 30 days."
        confirmText="Delete"
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
