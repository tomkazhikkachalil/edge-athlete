'use client';

import { useState } from 'react';
import Image from 'next/image';
import { orgMediaUrl } from '@/lib/media/org-site-media';
import { validateFiles } from '@/lib/media/validation';

const LABEL = 'block text-xs font-medium text-secondary mb-1';
const PILL = 'px-3 py-1.5 text-sm min-h-[36px] rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors disabled:opacity-50';

// Extracted from SitePanel (sports-team website program, N4) — the news
// composer's cover uses the same picker as the site's social image and icon.
/** One site asset: choose / replace / remove through the site's assets route. */
export default function AssetPicker({ id, label, hint, path, plural, orgId, siteId, onChange, showError, square }: { id: string; label: string; hint: string; path: string | null; plural: string; orgId: string; siteId: string; onChange: (path: string | null) => void; showError: (title: string, message?: string) => void; square?: boolean }) {
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
