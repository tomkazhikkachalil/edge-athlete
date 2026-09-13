'use client';

import { useState } from 'react';
import Image from 'next/image';
import { orgMediaUrl } from '@/lib/media/org-site-media';
import { validateFiles } from '@/lib/media/validation';
import { SPONSOR_TIERS, SPONSOR_TIER_LABELS, type SponsorTier } from '@/lib/site-builder/display';

/**
 * The sponsors list editor — Site Builder program 3, D2 (Sep 13 2026).
 * The sponsors moved into the editor from the console (the hero's and the
 * contact card's precedent, P10-C): one list of name · link · tier · logo,
 * ordered by drag on a desktop or the arrows at every width, saved WHOLE
 * through `set_sponsors` by the panel's "Save content". Logos upload
 * through the site's own asset route; a logo uploaded and then dropped
 * before the save is reclaimed by the panel (B5).
 */
export interface SponsorDraft {
  name: string;
  url: string;
  logoPath: string;
  tier: '' | SponsorTier;
}

export const SPONSORS_MAX = 20;

export function readSponsorDrafts(config: Record<string, unknown>): SponsorDraft[] {
  const raw = config.sponsors;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .slice(0, SPONSORS_MAX)
    .map(s => ({
      name: typeof s.name === 'string' ? s.name : '',
      url: typeof s.url === 'string' ? s.url : '',
      logoPath: typeof s.logoPath === 'string' ? s.logoPath : '',
      tier: typeof s.tier === 'string' && (SPONSOR_TIERS as readonly string[]).includes(s.tier) ? (s.tier as SponsorTier) : '',
    }));
}

/** The payload set_sponsors takes: blanks dropped, empty keys omitted. */
export function sponsorsPayload(drafts: SponsorDraft[]): Record<string, unknown>[] {
  return drafts
    .filter(s => s.name.trim())
    .map(s => ({
      name: s.name.trim(),
      ...(s.url.trim() ? { url: s.url.trim() } : {}),
      ...(s.logoPath ? { logoPath: s.logoPath } : {}),
      ...(s.tier ? { tier: s.tier } : {}),
    }));
}

const INPUT = 'w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-primary';
const ICON = 'inline-flex h-11 w-11 items-center justify-center rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors disabled:opacity-40 disabled:cursor-not-allowed';

export default function SponsorsField({
  idBase,
  siteId,
  plural,
  orgId,
  sponsors,
  onChange,
  showError,
  onUploaded,
  onRemoved,
}: {
  idBase: string;
  siteId: string;
  plural: string;
  orgId: string;
  sponsors: SponsorDraft[];
  onChange: (next: SponsorDraft[]) => void;
  showError: (title: string, message?: string) => void;
  onUploaded?: (path: string) => void;
  onRemoved?: (path: string) => void;
}) {
  const [dragging, setDragging] = useState<number | null>(null);
  const [uploading, setUploading] = useState<number | null>(null);
  const patch = (i: number, next: Partial<SponsorDraft>) => onChange(sponsors.map((s, j) => (j === i ? { ...s, ...next } : s)));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= sponsors.length || from === to) return;
    const next = [...sponsors];
    const [s] = next.splice(from, 1);
    next.splice(to, 0, s);
    onChange(next);
  };
  const remove = (i: number) => {
    const gone = sponsors[i];
    if (gone?.logoPath) onRemoved?.(gone.logoPath);
    onChange(sponsors.filter((_, j) => j !== i));
  };
  const upload = async (i: number, file: File) => {
    const { rejected } = validateFiles([file], { maxBytes: 10 * 1024 * 1024, allowVideo: false, maxCount: 1 });
    if (rejected.length > 0) {
      showError('Website', rejected[0].message);
      return;
    }
    setUploading(i);
    try {
      const form = new FormData();
      form.append('image', file);
      const res = await fetch(`/api/${plural}/${orgId}/site/assets`, { method: 'POST', body: form });
      const body = (await res.json().catch(() => ({}))) as { path?: string; error?: string };
      if (!res.ok || !body.path) {
        showError('Website', body.error || 'Failed to upload the logo');
        return;
      }
      const previous = sponsors[i]?.logoPath;
      if (previous) onRemoved?.(previous);
      onUploaded?.(body.path);
      patch(i, { logoPath: body.path });
    } catch {
      showError('Website', 'Upload failed — please try again');
    } finally {
      setUploading(null);
    }
  };

  return (
    <div className="space-y-2" data-sb-sponsors="">
      <ol className="space-y-2" aria-label="Sponsors">
        {sponsors.map((s, i) => {
          const logo = s.logoPath ? orgMediaUrl(siteId, s.logoPath) : null;
          const rowId = `${idBase}-${i}`;
          return (
            <li
              key={rowId}
              draggable
              onDragStart={e => {
                setDragging(i);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={e => {
                if (dragging !== null && dragging !== i) e.preventDefault();
              }}
              onDrop={e => {
                e.preventDefault();
                if (dragging !== null) move(dragging, i);
                setDragging(null);
              }}
              onDragEnd={() => setDragging(null)}
              className={`rounded-md border border-border bg-surface p-2 space-y-2 ${dragging === i ? 'opacity-50' : ''}`}
              data-sb-sponsor-row={i}
            >
              <div className="flex items-center gap-2">
                <span aria-hidden="true" className="hidden cursor-grab text-muted lg:inline">
                  ⋮⋮
                </span>
                <input id={`${rowId}-name`} type="text" value={s.name} maxLength={80} placeholder="Sponsor name" aria-label={`Sponsor ${i + 1} name`} onChange={e => patch(i, { name: e.target.value })} className={INPUT} />
                <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0} className={ICON} aria-label={`Move sponsor ${i + 1} up`} data-sb-sponsor-up="">
                  <i className="fas fa-arrow-up" aria-hidden="true"></i>
                </button>
                <button type="button" onClick={() => move(i, i + 1)} disabled={i === sponsors.length - 1} className={ICON} aria-label={`Move sponsor ${i + 1} down`} data-sb-sponsor-down="">
                  <i className="fas fa-arrow-down" aria-hidden="true"></i>
                </button>
                <button type="button" onClick={() => remove(i)} className={ICON} aria-label={`Remove sponsor ${i + 1}`}>
                  ×
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input id={`${rowId}-url`} type="url" value={s.url} maxLength={200} placeholder="https:// (optional)" aria-label={`Sponsor ${i + 1} link`} onChange={e => patch(i, { url: e.target.value })} className={`${INPUT} min-w-0 flex-1`} />
                <select id={`${rowId}-tier`} value={s.tier} aria-label={`Sponsor ${i + 1} tier`} onChange={e => patch(i, { tier: e.target.value as SponsorDraft['tier'] })} className={`${INPUT} w-auto`} data-sb-sponsor-tier="">
                  <option value="">No tier</option>
                  {SPONSOR_TIERS.map(t => (
                    <option key={t} value={t}>
                      {SPONSOR_TIER_LABELS[t]}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-1.5 text-xs text-tertiary">
                  {logo ? <Image src={logo} alt="" width={24} height={24} unoptimized className="rounded border border-border shrink-0" /> : 'Logo'}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp"
                    aria-label={`Sponsor ${i + 1} logo`}
                    className="w-32 text-xs"
                    disabled={uploading === i}
                    onChange={e => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (file) void upload(i, file);
                    }}
                  />
                </label>
              </div>
            </li>
          );
        })}
      </ol>
      {sponsors.length < SPONSORS_MAX && (
        <button type="button" onClick={() => onChange([...sponsors, { name: '', url: '', logoPath: '', tier: '' }])} className="min-h-[36px] rounded-md border border-border-strong px-3 text-sm text-secondary hover:bg-surface-sunken transition-colors" data-sb-sponsor-add="">
          + Add sponsor
        </button>
      )}
    </div>
  );
}
