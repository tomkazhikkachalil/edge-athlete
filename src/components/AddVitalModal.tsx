'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useDirtyClose } from '@/hooks/useDirtyClose';
import ConfirmModal from '@/components/ConfirmModal';
import { COPY } from '@/lib/copy';
import { MediaEditor } from '@/components/media-editor';
import { validateFiles } from '@/lib/media/validation';
import { uploadPostMedia } from '@/lib/media/upload';
import type { EditedMedia, EditorConfig, MediaAsset } from '@/lib/media/types';
import {
  VITAL_CATEGORIES,
  VITAL_METRICS_MAP,
  parseTimeToSeconds,
  formatSecondsToDisplay,
} from '@/lib/vitals-config';

const MAX_MEDIA_FILES = 4;
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB — same as CreatePostModal

const VITAL_EDITOR_CONFIG: EditorConfig = {
  aspectRatios: ['free', '1:1', '4:5'],
  allowVideo: true, // videos pass through untouched until the video phase
  maxAssets: MAX_MEDIA_FILES,
  output: { maxDimension: 2048, mime: 'image/jpeg', quality: 0.9 },
};

interface MediaFile {
  id: string;
  file: File;
  preview: string;
  url: string;
  type: 'image' | 'video';
}

interface AddVitalModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
}

interface FormState {
  categoryKey: string;
  metricKey: string;
  rawValue: string;
  notes: string;
  recordedAt: string;
}

type SubmitMode = 'metric_only' | 'with_post';

const today = () => new Date().toISOString().split('T')[0];

export default function AddVitalModal({ isOpen, onClose, onSaved }: AddVitalModalProps) {
  const [form, setForm] = useState<FormState>({
    categoryKey: '',
    metricKey: '',
    rawValue: '',
    notes: '',
    recordedAt: today(),
  });
  const [mode, setMode] = useState<SubmitMode>('metric_only');
  const [caption, setCaption] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Anything the open-reset effect below clears counts as unsaved work.
  const isDirty = () =>
    form.categoryKey !== '' ||
    form.metricKey !== '' ||
    form.rawValue.trim() !== '' ||
    form.notes.trim() !== '' ||
    caption.trim() !== '' ||
    mediaFiles.length > 0 ||
    mode !== 'metric_only';

  const { requestClose, confirmOpen, confirmDiscard, cancelDiscard } = useDirtyClose(isDirty, onClose);

  // Reset form when modal opens
  // State synchronisation, not a side effect: doing it during render means
  // the previous values never paint for a frame.
  const [syncedOpen, setSyncedOpen] = useState({ isOpen });
  if (
    syncedOpen.isOpen !== isOpen
  ) {
    setSyncedOpen({ isOpen });
    if (isOpen) {
      setForm({ categoryKey: '', metricKey: '', rawValue: '', notes: '', recordedAt: today() });
      setMode('metric_only');
      setCaption('');
      setVisibility('public');
      setMediaFiles([]);
      setError('');
    }
  }

  // Revoke object URLs on unmount and when files change
  useEffect(() => {
    return () => {
      mediaFiles.forEach(f => URL.revokeObjectURL(f.preview));
    };
  }, [mediaFiles]);

  // Picked files go through the shared media editor before attaching;
  // validation mirrors the server allowlist at pick time.
  const [editorAssets, setEditorAssets] = useState<MediaAsset[] | null>(null);

  const handleFileSelect = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    const { accepted, rejected } = validateFiles(Array.from(files), {
      maxBytes: MAX_FILE_SIZE_BYTES,
      allowVideo: true,
      maxCount: MAX_MEDIA_FILES,
      existingCount: mediaFiles.length,
    });
    if (rejected.length > 0) {
      setError(rejected[0].message);
    } else {
      setError('');
    }
    if (accepted.length === 0) return;
    setEditorAssets(
      accepted.map(file => ({
        id: `${Date.now()}-${Math.random()}`,
        file,
        kind: file.type.startsWith('video/') ? 'video' as const : 'image' as const,
      }))
    );
  }, [mediaFiles.length]);

  const handleEditorDone = (results: EditedMedia[]) => {
    setMediaFiles(prev => [
      ...prev,
      ...results.map(r => ({
        id: r.id,
        file: r.file,
        preview: r.previewUrl,
        url: r.previewUrl,
        type: r.kind,
      })),
    ]);
    setEditorAssets(null);
  };

  // Lock background scroll while open (iOS scroll-chaining behind overlays)
  useBodyScrollLock(isOpen);

  if (!isOpen) return null;

  const selectedCategory = VITAL_CATEGORIES.find(c => c.key === form.categoryKey);
  const selectedMetric = form.metricKey ? VITAL_METRICS_MAP[form.metricKey] : null;

  const handleCategoryChange = (key: string) => {
    setForm(prev => ({ ...prev, categoryKey: key, metricKey: '', rawValue: '' }));
    setError('');
  };

  const handleMetricChange = (key: string) => {
    setForm(prev => ({ ...prev, metricKey: key, rawValue: '' }));
    setError('');
  };

  const removeFile = (id: string) => {
    setMediaFiles(prev => {
      const removed = prev.find(f => f.id === id);
      if (removed) URL.revokeObjectURL(removed.preview);
      return prev.filter(f => f.id !== id);
    });
  };

  // Parse and validate metric value, returns { numericValue, displayValue } or null on error
  const parseMetricValue = (): { numericValue: number; displayValue: string } | null => {
    if (!selectedMetric) return null;
    const trimmed = form.rawValue.trim();

    if (selectedMetric.time_format === 'mm:ss') {
      const n = parseTimeToSeconds(trimmed, 'mm:ss');
      if (n === null) { setError('Enter time as M:SS (e.g. 4:32 or 22:15). Seconds must be 0–59.'); return null; }
      return { numericValue: n, displayValue: formatSecondsToDisplay(n, 'mm:ss') };
    } else if (selectedMetric.time_format === 'decimal_seconds') {
      const n = parseTimeToSeconds(trimmed, 'decimal_seconds');
      if (n === null) { setError('Enter a decimal number (e.g. 4.95).'); return null; }
      return { numericValue: n, displayValue: `${n} sec` };
    } else {
      const n = parseFloat(trimmed);
      if (isNaN(n)) { setError('Enter a valid number.'); return null; }
      return { numericValue: n, displayValue: `${n} ${selectedMetric.unit}` };
    }
  };

  const uploadFile = async (file: File): Promise<string> => (await uploadPostMedia(file)).url;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!form.categoryKey) { setError('Please select a category.'); return; }
    if (!form.metricKey) { setError('Please select a metric.'); return; }
    if (!form.rawValue.trim()) { setError('Please enter a value.'); return; }
    if (!form.recordedAt) { setError('Please enter a date.'); return; }

    const metric = VITAL_METRICS_MAP[form.metricKey];
    if (!metric) { setError('Invalid metric selected.'); return; }

    const parsed = parseMetricValue();
    if (!parsed) return;
    const { numericValue, displayValue } = parsed;

    setSaving(true);

    try {
      if (mode === 'metric_only') {
        // ── Quick entry ─────────────────────────────────────────────
        const res = await fetch('/api/vitals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            metric_key: metric.key,
            metric_category: form.categoryKey,
            metric_label: metric.label,
            value: numericValue,
            value_display: displayValue,
            unit: metric.unit,
            notes: form.notes.trim() || null,
            recorded_at: form.recordedAt,
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to save');
        }
      } else {
        // ── Metric + post ───────────────────────────────────────────
        // 1. Upload media
        const uploadedMedia: { url: string; type: 'image' | 'video'; sortOrder: number }[] = [];
        for (let i = 0; i < mediaFiles.length; i++) {
          const url = await uploadFile(mediaFiles[i].file);
          uploadedMedia.push({ url, type: mediaFiles[i].type, sortOrder: i });
        }

        // 2. Create post
        const postCaption = caption.trim() || `${metric.label} · ${displayValue}`;
        const postRes = await fetch('/api/posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            postType: 'general',
            postCategory: 'training',
            caption: postCaption,
            visibility,
            media: uploadedMedia,
            stats_data: {
              type: 'vitals_entry',
              metric_key: metric.key,
              metric_label: metric.label,
              value: numericValue,
              value_display: displayValue,
              unit: metric.unit,
            },
            taggedProfiles: [],
          }),
        });

        if (!postRes.ok) {
          const data = await postRes.json();
          throw new Error(data.error || 'Failed to create post');
        }

        const postResult = await postRes.json();
        const createdPostId: string = postResult.post.id;

        // 3. Create vital (linked to post)
        const vitalRes = await fetch('/api/vitals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            metric_key: metric.key,
            metric_category: form.categoryKey,
            metric_label: metric.label,
            value: numericValue,
            value_display: displayValue,
            unit: metric.unit,
            notes: form.notes.trim() || null,
            recorded_at: form.recordedAt,
            linked_post_id: createdPostId,
          }),
        });

        if (!vitalRes.ok) {
          // Vital failed — attempt cleanup of orphaned post
          try {
            await fetch(`/api/posts/${createdPostId}`, { method: 'DELETE' });
            throw new Error('Metric entry failed — the post was also removed. Please try again.');
          } catch (cleanupErr) {
            if (cleanupErr instanceof Error && cleanupErr.message.includes('Metric entry failed')) {
              throw cleanupErr;
            }
            throw new Error('Metric entry failed. A post may have been created — check Training Activity.');
          }
        }
      }

      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <ConfirmModal
        isOpen={confirmOpen}
        title={COPY.FORMS.DISCARD_TITLE}
        message={COPY.FORMS.DISCARD_CONFIRM}
        confirmText={COPY.FORMS.DISCARD_ACTION}
        cancelText={COPY.FORMS.KEEP_EDITING}
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
      <div className="bg-surface-raised rounded-xl shadow-xl w-full max-w-md max-h-modal overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border-subtle">
          <div>
            <h2 className="text-lg font-bold text-primary">Add Vital Entry</h2>
            <p className="text-xs text-muted mt-0.5">Each entry is saved permanently as part of your development record.</p>
          </div>
          <button
            onClick={requestClose}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full hover:bg-surface-sunken text-muted transition-colors"
          >
            <i className="fas fa-times text-sm"></i>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Category */}
          <div>
            <label className="block text-sm font-semibold text-secondary mb-1.5">Category</label>
            <div className="grid grid-cols-2 gap-2">
              {VITAL_CATEGORIES.map(cat => (
                <button
                  key={cat.key}
                  type="button"
                  onClick={() => handleCategoryChange(cat.key)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                    form.categoryKey === cat.key
                      ? 'border-violet-500 bg-brand-soft text-brand-fg-strong'
                      : 'border-border text-tertiary hover:border-border-strong hover:bg-surface-muted'
                  }`}
                >
                  <i className={`${cat.icon} text-xs`}></i>
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* Metric */}
          {selectedCategory && (
            <div>
              <label className="block text-sm font-semibold text-secondary mb-1.5">Metric</label>
              <select
                value={form.metricKey}
                onChange={e => handleMetricChange(e.target.value)}
                className="w-full px-3 py-2.5 border border-border-strong rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              >
                <option value="">Select a metric…</option>
                {selectedCategory.metrics.map(m => (
                  <option key={m.key} value={m.key}>{m.label} ({m.unit})</option>
                ))}
              </select>
            </div>
          )}

          {/* Value */}
          {selectedMetric && (
            <div>
              <label className="block text-sm font-semibold text-secondary mb-1.5">
                {selectedMetric.label}
                <span className="font-normal text-muted ml-1">({selectedMetric.unit})</span>
              </label>
              <input
                type="text"
                value={form.rawValue}
                onChange={e => { setForm(prev => ({ ...prev, rawValue: e.target.value })); setError(''); }}
                placeholder={selectedMetric.placeholder}
                className="w-full px-3 py-2.5 border border-border-strong rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                autoFocus
              />
              {selectedMetric.time_format === 'mm:ss' && (
                <p className="text-xs text-faint mt-1">Enter as minutes:seconds (e.g. 4:32)</p>
              )}
              {selectedMetric.time_format === 'decimal_seconds' && (
                <p className="text-xs text-faint mt-1">Enter as decimal seconds (e.g. 4.95)</p>
              )}
            </div>
          )}

          {/* Date */}
          {selectedMetric && (
            <div>
              <label className="block text-sm font-semibold text-secondary mb-1.5">Date Recorded</label>
              <input
                type="date"
                value={form.recordedAt}
                max={today()}
                onChange={e => setForm(prev => ({ ...prev, recordedAt: e.target.value }))}
                className="w-full px-3 py-2.5 border border-border-strong rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
              <p className="text-xs text-faint mt-1">You can back-date entries to record historical results.</p>
            </div>
          )}

          {/* Notes */}
          {selectedMetric && (
            <div>
              <label className="block text-sm font-semibold text-secondary mb-1.5">
                Notes <span className="font-normal text-faint">(optional)</span>
              </label>
              <textarea
                value={form.notes}
                onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="e.g. Pre-season combine, fresh legs, indoor track…"
                rows={2}
                className="w-full px-3 py-2.5 border border-border-strong rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none"
              />
            </div>
          )}

          {/* Mode toggle */}
          {selectedMetric && (
            <div>
              <label className="block text-sm font-semibold text-secondary mb-1.5">Save as</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => { setMode('metric_only'); setMediaFiles([]); setCaption(''); setError(''); }}
                  className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                    mode === 'metric_only'
                      ? 'border-violet-500 bg-brand-soft text-brand-fg-strong'
                      : 'border-border text-tertiary hover:border-border-strong hover:bg-surface-muted'
                  }`}
                >
                  <i className="fas fa-chart-line text-xs"></i>
                  Metric only
                </button>
                <button
                  type="button"
                  onClick={() => { setMode('with_post'); setError(''); }}
                  className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                    mode === 'with_post'
                      ? 'border-violet-500 bg-brand-soft text-brand-fg-strong'
                      : 'border-border text-tertiary hover:border-border-strong hover:bg-surface-muted'
                  }`}
                >
                  <i className="fas fa-camera text-xs"></i>
                  Add media
                </button>
              </div>
            </div>
          )}

          {/* Media upload section — only in "with_post" mode */}
          {selectedMetric && mode === 'with_post' && (
            <>
              {/* Caption */}
              <div>
                <label className="block text-sm font-semibold text-secondary mb-1.5">
                  Caption <span className="font-normal text-faint">(optional)</span>
                </label>
                <textarea
                  value={caption}
                  onChange={e => setCaption(e.target.value)}
                  placeholder={`${selectedMetric?.label} · ${form.rawValue || '…'}`}
                  rows={2}
                  className="w-full px-3 py-2.5 border border-border-strong rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none"
                />
              </div>

              {/* Media upload */}
              <div>
                <label className="block text-sm font-semibold text-secondary mb-1.5">
                  Media <span className="font-normal text-faint">(up to {MAX_MEDIA_FILES} files, 5MB each)</span>
                </label>

                {/* Preview strip */}
                {mediaFiles.length > 0 && (
                  <div className="flex gap-2 mb-2 flex-wrap">
                    {mediaFiles.map(f => (
                      <div key={f.id} className="relative w-20 h-20 rounded-lg overflow-hidden border border-border bg-surface-sunken shrink-0">
                        {f.type === 'image' ? (
                          // Raw <img>: blob: object URL. The optimizer fetches
                          // server-side and cannot read a client-only URL —
                          // next/image force-sets unoptimized for these, so
                          // <Image> would be pure overhead.
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={f.preview} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <i className="fas fa-play-circle text-2xl text-faint"></i>
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => removeFile(f.id)}
                          className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 transition-colors"
                        >
                          <i className="fas fa-times text-xs" style={{ fontSize: '9px' }}></i>
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Drop zone / file trigger */}
                {mediaFiles.length < MAX_MEDIA_FILES && (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full border-2 border-dashed border-border-strong rounded-lg py-4 px-3 text-sm text-muted hover:border-violet-400 hover:text-brand-fg transition-colors flex items-center justify-center gap-2"
                  >
                    <i className="fas fa-cloud-upload-alt"></i>
                    {mediaFiles.length === 0 ? 'Add photos or video' : 'Add more'}
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,video/*"
                  multiple
                  className="hidden"
                  onChange={e => handleFileSelect(e.target.files)}
                  onClick={e => { (e.target as HTMLInputElement).value = ''; }}
                />
              </div>

              {/* Visibility */}
              <div>
                <label className="block text-sm font-semibold text-secondary mb-1.5">Visibility</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['public', 'private'] as const).map(v => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setVisibility(v)}
                      className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                        visibility === v
                          ? 'border-violet-500 bg-brand-soft text-brand-fg-strong'
                          : 'border-border text-tertiary hover:border-border-strong hover:bg-surface-muted'
                      }`}
                    >
                      <i className={`fas ${v === 'public' ? 'fa-globe' : 'fa-lock'} text-xs`}></i>
                      {v.charAt(0).toUpperCase() + v.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-3 py-2 rounded-lg text-sm">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={requestClose}
              className="flex-1 px-4 py-2.5 border border-border-strong text-secondary rounded-lg text-sm font-medium hover:bg-surface-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !selectedMetric}
              className="flex-1 px-4 py-2.5 bg-brand text-white rounded-lg text-sm font-semibold hover:bg-brand-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? (
                <><i className="fas fa-spinner fa-spin mr-1.5"></i>
                  {mode === 'with_post' && mediaFiles.length > 0 ? 'Uploading…' : 'Saving…'}
                </>
              ) : mode === 'with_post' ? 'Save & Post' : 'Save Entry'}
            </button>
          </div>
        </form>
      </div>

      {/* Shared media editor (z-[65], above this modal) */}
      {editorAssets && (
        <MediaEditor
          assets={editorAssets}
          config={VITAL_EDITOR_CONFIG}
          onDone={handleEditorDone}
          onCancel={() => setEditorAssets(null)}
        />
      )}
    </div>
  );
}
