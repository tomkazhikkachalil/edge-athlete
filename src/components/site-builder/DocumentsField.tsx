'use client';

import { useState } from 'react';
import { DOCUMENTS_MAX, type DocumentDraft } from '@/lib/site-builder/documents-draft';

/**
 * The documents list editor — sports-team website program, H1 (Sep 27 2026).
 * Moved into the editor from the console (one home): each row is a title and
 * either a PDF uploaded through the site's own asset route or an https link;
 * the arrows order the list; the panel's "Save content" writes it WHOLE
 * through `set_documents`. A PDF uploaded and then dropped before the save is
 * reclaimed by the panel (the sponsors' logos recipe, B5).
 */

const INPUT = 'w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-primary';
const ICON = 'inline-flex h-9 w-9 items-center justify-center rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const PILL = 'px-3 py-1.5 text-sm min-h-[36px] rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors disabled:opacity-50';

export default function DocumentsField({
  idBase,
  plural,
  orgId,
  documents,
  onChange,
  showError,
  onUploaded,
  onRemoved,
}: {
  idBase: string;
  plural: string;
  orgId: string;
  documents: DocumentDraft[];
  onChange: (next: DocumentDraft[]) => void;
  showError: (title: string, message?: string) => void;
  onUploaded?: (path: string) => void;
  onRemoved?: (path: string) => void;
}) {
  const [uploading, setUploading] = useState<number | null>(null);
  const patch = (i: number, p: Partial<DocumentDraft>) => onChange(documents.map((d, j) => (j === i ? { ...d, ...p } : d)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= documents.length) return;
    const next = [...documents];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const remove = (i: number) => {
    const path = documents[i]?.path;
    if (path) onRemoved?.(path);
    onChange(documents.filter((_, j) => j !== i));
  };
  const upload = async (i: number, file: File | undefined) => {
    if (!file) return;
    if (file.type !== 'application/pdf') {
      showError('Website', 'Documents must be PDF files.');
      return;
    }
    setUploading(i);
    try {
      const formData = new FormData();
      formData.append('document', file);
      const res = await fetch(`/api/${plural}/${orgId}/site/assets`, { method: 'POST', body: formData });
      const body = (await res.json().catch(() => ({}))) as { path?: string; error?: string };
      if (!res.ok || !body.path) {
        showError('Website', body.error || 'Failed to upload the document');
        return;
      }
      onUploaded?.(body.path);
      patch(i, { path: body.path, url: '' });
    } catch {
      showError('Website', 'Upload failed — please try again');
    } finally {
      setUploading(null);
    }
  };

  return (
    <div className="space-y-3" data-sb-documents="">
      {documents.map((d, i) => (
        <div key={i} className="space-y-2 rounded-lg border border-border p-3" data-sb-document={i}>
          <input
            type="text"
            value={d.title}
            maxLength={80}
            onChange={e => patch(i, { title: e.target.value })}
            placeholder="Title (e.g. Code of conduct)"
            aria-label={`Document ${i + 1} title`}
            className={INPUT}
          />
          {d.path ? (
            <p className="flex items-center gap-2 text-xs text-secondary">
              PDF attached
              <button
                type="button"
                onClick={() => {
                  onRemoved?.(d.path);
                  patch(i, { path: '' });
                }}
                className="text-tertiary hover:text-primary underline"
                aria-label={`Detach document ${i + 1} file`}
              >
                Detach
              </button>
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="url"
                value={d.url}
                maxLength={200}
                onChange={e => patch(i, { url: e.target.value })}
                placeholder="https:// link"
                aria-label={`Document ${i + 1} link`}
                className={`${INPUT} min-w-0 flex-1`}
              />
              <label className={`${PILL} cursor-pointer`}>
                {uploading === i ? 'Uploading…' : 'Upload PDF'}
                <input
                  id={`${idBase}-${i}-file`}
                  type="file"
                  accept="application/pdf"
                  className="sr-only"
                  aria-label={`Document ${i + 1} file`}
                  disabled={uploading !== null}
                  onChange={e => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    void upload(i, file);
                  }}
                />
              </label>
            </div>
          )}
          <div className="flex gap-1">
            <button type="button" className={ICON} onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move document ${i + 1} up`}>
              ▲
            </button>
            <button type="button" className={ICON} onClick={() => move(i, 1)} disabled={i === documents.length - 1} aria-label={`Move document ${i + 1} down`}>
              ▼
            </button>
            <button type="button" className={`${ICON} ml-auto`} onClick={() => remove(i)} aria-label={`Remove document ${i + 1}`}>
              ✕
            </button>
          </div>
        </div>
      ))}
      {documents.length < DOCUMENTS_MAX && (
        <button type="button" className={PILL} onClick={() => onChange([...documents, { title: '', path: '', url: '' }])} data-sb-document-add="">
          + Add document
        </button>
      )}
    </div>
  );
}
