'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { useAuth } from '@/lib/auth';
import AppHeader from '@/components/AppHeader';
import { useToast } from '@/components/Toast';
import { orgMediaUrl } from '@/lib/media/org-site-media';
import { validateFiles } from '@/lib/media/validation';
import {
  PAGE_BODY_MAX_BLOCKS,
  parsePageBody,
  type PageBlock,
} from '@/lib/org-sites/validate';

// ── The page block editor (phase 3 R3) ──────────────────────────────────────
// The org-console template one level deeper (the competitions-detail
// precedent): one org_site_pages row, its ordered block array edited
// inline — move/remove/patch-at-index (the RoutineEditorModal shape,
// rendered flat: never a modal, 375px). Save PATCHes {title, body};
// the Publish toggle PATCHes visibility immediately. Unsaved edits get
// a chip + a beforeunload guard (useDirtyClose is modal-oriented — App
// Router back-nav isn't interceptable, so no back-guard by design).

const BLOCK_LABELS: Record<PageBlock['type'], string> = {
  heading: 'Heading',
  paragraph: 'Paragraph',
  image: 'Image',
  'link-list': 'Link list',
};

const INPUT_CLS =
  'px-3 py-2 border border-border-strong rounded-md outline-none text-sm w-full';

function newBlock(type: PageBlock['type']): PageBlock {
  switch (type) {
    case 'heading':
      return { type: 'heading', text: '' };
    case 'paragraph':
      return { type: 'paragraph', text: '' };
    case 'image':
      return { type: 'image', path: '', alt: '' } as unknown as PageBlock;
    case 'link-list':
      return { type: 'link-list', links: [{ label: '', url: '' }] } as unknown as PageBlock;
  }
}

export default function OrgSitePageEditor() {
  const params = useParams();
  const side = params.side as string;
  const orgId = params.id as string;
  const pageId = params.pageId as string;
  const validSide = side === 'league' || side === 'club';
  const plural = side === 'league' ? 'leagues' : 'clubs';

  const { user, initialAuthCheckComplete } = useAuth();
  const { showSuccess, showError } = useToast();

  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [slug, setSlug] = useState('');
  const [siteId, setSiteId] = useState('');
  const [title, setTitle] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'draft'>('draft');
  const [blocks, setBlocks] = useState<PageBlock[]>([]);
  const [savedSnapshot, setSavedSnapshot] = useState('');
  const [saving, setSaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const base = `/api/${plural}/${orgId}/site/pages/${pageId}`;
  const dirty = JSON.stringify({ title, blocks }) !== savedSnapshot;

  useEffect(() => {
    if (!validSide || !user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(base);
        if (cancelled) return;
        if (!res.ok) {
          setAuthorized(false);
          return;
        }
        const body = await res.json();
        if (cancelled) return;
        setAuthorized(true);
        const page = body.page;
        setSlug(page.slug ?? '');
        setSiteId(page.site_id ?? '');
        setTitle(page.title ?? '');
        setVisibility(page.visibility === 'public' ? 'public' : 'draft');
        const parsedBlocks = parsePageBody(page.body);
        setBlocks(parsedBlocks);
        setSavedSnapshot(JSON.stringify({ title: page.title ?? '', blocks: parsedBlocks }));
      } catch {
        if (!cancelled) setAuthorized(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [validSide, base, user?.id, reloadKey]);

  // Refresh/close with unsaved edits → the native prompt (the
  // useDirtyClose beforeunload recipe; in-app nav is not guarded).
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const patchBlock = (index: number, patch: Partial<PageBlock>) =>
    setBlocks(b => b.map((blk, i) => (i === index ? ({ ...blk, ...patch } as PageBlock) : blk)));
  const moveBlock = (index: number, delta: -1 | 1) =>
    setBlocks(b => {
      const next = index + delta;
      if (next < 0 || next >= b.length) return b;
      const copy = [...b];
      [copy[index], copy[next]] = [copy[next], copy[index]];
      return copy;
    });
  const removeBlock = (index: number) => setBlocks(b => b.filter((_, i) => i !== index));

  const uploadAsset = async (index: number, file: File | undefined) => {
    if (!file) return;
    const { accepted, rejected } = validateFiles([file], {
      maxBytes: 10 * 1024 * 1024,
      allowVideo: false,
      maxCount: 1,
    });
    if (rejected.length > 0) {
      showError('Website', rejected[0].message);
      return;
    }
    try {
      const formData = new FormData();
      formData.append('image', accepted[0]);
      const res = await fetch(`/api/${plural}/${orgId}/site/assets`, {
        method: 'POST',
        body: formData,
      });
      const body = await res.json();
      if (!res.ok) {
        showError('Website', body.error || 'Failed to upload the image');
        return;
      }
      patchBlock(index, { path: body.path } as Partial<PageBlock>);
    } catch {
      showError('Website', 'Upload failed — please try again');
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(base, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), body: blocks }),
      });
      const body = await res.json();
      if (!res.ok) {
        showError('Website', body.error || 'Failed to save the page');
        return;
      }
      showSuccess('Website', 'Page saved');
      setSavedSnapshot(JSON.stringify({ title: title.trim(), blocks }));
    } catch {
      showError('Website', 'Failed to save the page');
    } finally {
      setSaving(false);
    }
  };

  const setPageVisibility = async (next: 'public' | 'draft') => {
    try {
      const res = await fetch(base, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visibility: next }),
      });
      const body = await res.json();
      if (!res.ok) {
        showError('Website', body.error || 'Failed to update visibility');
        return;
      }
      setVisibility(next);
      showSuccess('Website', next === 'public' ? 'Page is live' : 'Page set to draft');
      setReloadKey(k => k + 1);
    } catch {
      showError('Website', 'Failed to update visibility');
    }
  };

  if (!initialAuthCheckComplete || (user && authorized === null)) {
    return (
      <div className="min-h-screen bg-canvas">
        <AppHeader showSearch={false} />
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand"></div>
        </div>
      </div>
    );
  }

  if (!user || authorized === false) {
    return (
      <div className="min-h-screen bg-canvas">
        <AppHeader showSearch={false} />
        <div className="flex items-center justify-center py-20">
          <div className="text-center max-w-md mx-auto px-4">
            <h1 className="text-2xl font-bold text-primary mb-2">Managers only</h1>
            <p className="text-sm text-tertiary mb-4">
              This page editor is for the organization&apos;s owner and managers.
            </p>
            <Link
              href={`/app/org/${side}/${orgId}`}
              className="text-sm text-brand-fg hover:text-brand-fg-strong font-medium"
            >
              Back to the console →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas">
      <AppHeader showSearch={false} />
      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-muted">
              Page editor · /{slug}
              {visibility === 'public' ? (
                <span className="text-emerald-600"> · public</span>
              ) : (
                <span className="text-amber-600"> · draft</span>
              )}
            </p>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              maxLength={120}
              aria-label="Page title"
              className="mt-1 text-xl font-bold text-primary bg-transparent border-b border-border-strong outline-none w-full"
            />
          </div>
          <Link
            href={`/app/org/${side}/${orgId}`}
            className="text-sm text-brand-fg hover:text-brand-fg-strong font-medium shrink-0"
          >
            Back to the console →
          </Link>
        </div>

        <section
          aria-label="Page blocks"
          className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6 space-y-4"
        >
          {blocks.length === 0 && (
            <p className="text-sm text-tertiary">No blocks yet — add one below.</p>
          )}
          {blocks.map((block, index) => (
            <div key={index} className="border border-border rounded-lg p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted">
                  {BLOCK_LABELS[block.type]}
                </span>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => moveBlock(index, -1)}
                    disabled={index === 0}
                    aria-label={`Move block ${index + 1} up`}
                    className="px-2 py-1 text-xs rounded text-tertiary hover:bg-surface-sunken disabled:opacity-40"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveBlock(index, 1)}
                    disabled={index === blocks.length - 1}
                    aria-label={`Move block ${index + 1} down`}
                    className="px-2 py-1 text-xs rounded text-tertiary hover:bg-surface-sunken disabled:opacity-40"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => removeBlock(index)}
                    aria-label={`Remove block ${index + 1}`}
                    className="px-2 py-1 text-xs rounded text-tertiary hover:text-red-600"
                  >
                    ✕
                  </button>
                </div>
              </div>

              {block.type === 'heading' && (
                <input
                  type="text"
                  value={block.text}
                  onChange={e => patchBlock(index, { text: e.target.value } as Partial<PageBlock>)}
                  maxLength={120}
                  placeholder="Heading text"
                  aria-label={`Heading text for block ${index + 1}`}
                  className={INPUT_CLS}
                />
              )}
              {block.type === 'paragraph' && (
                <textarea
                  value={block.text}
                  onChange={e => patchBlock(index, { text: e.target.value } as Partial<PageBlock>)}
                  maxLength={2000}
                  rows={4}
                  placeholder="Paragraph text"
                  aria-label={`Paragraph text for block ${index + 1}`}
                  className={INPUT_CLS}
                />
              )}
              {block.type === 'image' && (
                <div className="space-y-2">
                  {block.path && orgMediaUrl(siteId, block.path) ? (
                    <Image
                      src={orgMediaUrl(siteId, block.path)!}
                      alt={block.alt || 'Page image'}
                      width={480}
                      height={270}
                      unoptimized
                      className="h-auto w-full max-w-sm rounded-md border border-border"
                    />
                  ) : (
                    <p className="text-xs text-tertiary">No image yet.</p>
                  )}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp"
                    aria-label={`Image file for block ${index + 1}`}
                    onChange={e => {
                      void uploadAsset(index, e.target.files?.[0]);
                      e.target.value = '';
                    }}
                    className="block text-sm text-secondary"
                  />
                  <input
                    type="text"
                    value={block.alt}
                    onChange={e => patchBlock(index, { alt: e.target.value } as Partial<PageBlock>)}
                    maxLength={200}
                    placeholder="Describe the image (required)"
                    aria-label={`Image description for block ${index + 1}`}
                    className={INPUT_CLS}
                  />
                </div>
              )}
              {block.type === 'link-list' && (
                <div className="space-y-2">
                  {block.links.map((link, j) => (
                    <div key={j} className="flex flex-wrap gap-2">
                      <input
                        type="text"
                        value={link.label}
                        onChange={e =>
                          patchBlock(index, {
                            links: block.links.map((l, k) =>
                              k === j ? { ...l, label: e.target.value } : l
                            ),
                          } as Partial<PageBlock>)
                        }
                        maxLength={80}
                        placeholder="Link label"
                        aria-label={`Link ${j + 1} label for block ${index + 1}`}
                        className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm min-w-0 flex-1"
                      />
                      <input
                        type="url"
                        value={link.url}
                        onChange={e =>
                          patchBlock(index, {
                            links: block.links.map((l, k) =>
                              k === j ? { ...l, url: e.target.value } : l
                            ),
                          } as Partial<PageBlock>)
                        }
                        maxLength={200}
                        placeholder="https://"
                        aria-label={`Link ${j + 1} url for block ${index + 1}`}
                        className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm min-w-0 flex-1"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          patchBlock(index, {
                            links: block.links.filter((_, k) => k !== j),
                          } as Partial<PageBlock>)
                        }
                        aria-label={`Remove link ${j + 1} from block ${index + 1}`}
                        className="px-2 text-tertiary hover:text-primary"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  {block.links.length < 20 && (
                    <button
                      type="button"
                      onClick={() =>
                        patchBlock(index, {
                          links: [...block.links, { label: '', url: '' }],
                        } as Partial<PageBlock>)
                      }
                      className="px-3 py-1.5 text-sm rounded-md text-tertiary hover:bg-surface-sunken transition-colors"
                    >
                      + Add link
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}

          {blocks.length < PAGE_BODY_MAX_BLOCKS && (
            <div className="flex flex-wrap gap-2 pt-1">
              {(Object.keys(BLOCK_LABELS) as PageBlock['type'][]).map(type => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setBlocks(b => [...b, newBlock(type)])}
                  className="px-3 py-1.5 text-sm rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                >
                  + {BLOCK_LABELS[type]}
                </button>
              ))}
            </div>
          )}
        </section>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="px-4 py-2 text-sm min-h-[40px] rounded-lg bg-brand text-white font-medium hover:bg-brand-hover transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save page'}
          </button>
          <button
            type="button"
            onClick={() => void setPageVisibility(visibility === 'public' ? 'draft' : 'public')}
            className="px-3 py-1.5 text-sm rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
          >
            {visibility === 'public' ? 'Set to draft' : 'Publish page'}
          </button>
          {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
        </div>
      </main>
    </div>
  );
}
