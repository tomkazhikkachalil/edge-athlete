'use client';

import { useId, useRef, useState, type SyntheticEvent } from 'react';
import CaptureInputs from '@/components/media/CaptureInputs';
import MediaTile from '@/components/media/MediaTile';
import VideoFrame from '@/components/media/VideoFrame';
import InfoToggle from '@/components/mech/InfoToggle';
import { CameraIcon, CloseIcon, VideoIcon } from '@/components/golf/scoring/icons';
import { AdjustIcon, CoverIcon, CropIcon, FilterIcon, PlayMark, RetryIcon, UploadIcon } from './icons';

/**
 * The composer's media block in the mechanical dialect (Tom's General post
 * spec, Nov 26 2026 — C3): the label and its info key, three capture keys,
 * the thumbnail strip, and the edit keys of the selected thumbnail.
 *
 * It draws; it owns nothing. Capture, pick and upload are the composer's
 * (`onFiles` → the same validate → attach / editor path; the upload queue's
 * state arrives through `uploadOf`). The limits are enforced as before and
 * shown only behind the info key (R3, A12).
 */
export interface ComposerMediaItem {
  id: string;
  url: string;
  type: 'image' | 'video';
  /** A video's poster object URL, once grabbed. */
  posterUrl?: string;
  /** The editor can open it (a local file is at hand). */
  editable: boolean;
  /** A video over the clip limit: it waits for a trim. */
  tooLong: boolean;
  /** An iPhone HEVC clip the server converts after Post. */
  willProcess: boolean;
}

export interface ComposerUpload {
  status: 'pending' | 'failed' | 'stored' | 'processing';
  /** 0..1 while pending. */
  progress: number;
}

export type MediaEditTool = 'crop' | 'adjust' | 'filter';

interface MediaSectionProps {
  items: ComposerMediaItem[];
  uploadOf: (id: string) => ComposerUpload;
  onFiles: (files: FileList | File[], source: 'camera' | 'library') => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  /** No tool: the editor's own first tool (a video's Clips). */
  onEdit: (id: string, tool?: MediaEditTool) => void;
  onCover: (id: string) => void;
  onMove: (from: number, to: number) => void;
  onVideoMeta: (id: string, el: HTMLVideoElement) => void;
  /** The info panel's lines: the app's real limits. */
  infoLines: string[];
}

const RING = 2 * Math.PI * 12.5;

function TintKey({ label, colour, fill, ring, onClick, hook, children }: {
  label: string;
  colour: string;
  fill: string;
  ring: string;
  onClick: () => void;
  hook: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-compose-capture={hook}
      className="ea-mech-tintkey flex h-16 min-w-0 flex-col items-center justify-center gap-1 rounded-[14px]"
      style={{ ['--tint-ring' as string]: ring }}
    >
      <span aria-hidden="true" className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-[10px]" style={{ backgroundColor: fill, color: colour }}>
        {children}
      </span>
      <span className="text-xs font-semibold leading-4">{label}</span>
    </button>
  );
}

export default function MediaSection({ items, uploadOf, onFiles, selectedId, onSelect, onRemove, onRetry, onEdit, onCover, onMove, onVideoMeta, infoLines }: MediaSectionProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [dragged, setDragged] = useState<number | null>(null);
  const infoId = useId();
  const selected = items.find(item => item.id === selectedId) ?? null;
  const selectedIndex = selected ? items.indexOf(selected) : -1;

  return (
    <section
      aria-label="Media"
      className="min-w-0 rounded-[14px]"
      style={dropping ? { boxShadow: '0 0 0 2px var(--mech-selected-border)', backgroundColor: 'var(--mech-selected-fill)' } : undefined}
      data-compose-media=""
      data-media-count={items.length}
      // The whole block is an invisible drop target for FILES (a thumbnail's
      // own reorder drag carries no files and is ignored here).
      onDrop={e => {
        e.preventDefault();
        setDropping(false);
        if (e.dataTransfer.files?.length) onFiles(e.dataTransfer.files, 'library');
      }}
      onDragOver={e => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={e => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDropping(false);
      }}
    >
      <div className="flex h-7 items-center justify-between">
        <h3 className="ea-mech-micro">Media</h3>
        {/* A 44 px target around a 28 px circle: pulled into the 28 px row. */}
        <InfoToggle open={infoOpen} onToggle={() => setInfoOpen(o => !o)} label="About media" controls={infoId} className="-my-2 -mr-2" />
      </div>
      {infoOpen && (
        <div id={infoId} className="ea-mech-panel mt-2 rounded-xl px-3.5 py-3 text-xs leading-5 text-[color:var(--mech-text-soft)]" data-compose-media-info="">
          {infoLines.map(line => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}

      {/* Capture keys. `capture` is a phone hint: Photo and Video open the
          camera there, the file chooser on a computer; Upload is the library. */}
      <CaptureInputs onFiles={files => onFiles(files, 'camera')} allowVideo>
        {({ openPhoto, openVideo }) => (
          <div className="mt-2 grid grid-cols-3 gap-2">
            <input
              ref={fileRef}
              type="file"
              multiple
              accept="image/*,video/*"
              className="hidden"
              onClick={e => { (e.target as HTMLInputElement).value = ''; }}
              onChange={e => e.target.files && onFiles(e.target.files, 'library')}
            />
            <TintKey label="Photo" colour="var(--mech-media)" fill="var(--mech-media-fill)" ring="var(--mech-media-ring)" onClick={openPhoto} hook="photo">
              <CameraIcon size={18} />
            </TintKey>
            <TintKey label="Video" colour="var(--mech-video)" fill="var(--mech-video-fill)" ring="var(--mech-video-ring)" onClick={() => openVideo?.()} hook="video">
              <VideoIcon size={18} />
            </TintKey>
            <TintKey label="Upload" colour="var(--mech-upload)" fill="var(--mech-upload-fill)" ring="var(--mech-upload-ring)" onClick={() => fileRef.current?.click()} hook="upload">
              <UploadIcon size={18} />
            </TintKey>
          </div>
        )}
      </CaptureInputs>

      {items.length > 0 && (
        <ul className="ea-mech-scroll -mr-1 mt-1 flex gap-2 overflow-x-auto pb-1 pr-2 pt-2" data-scroll-x="" data-compose-thumbs="">
          {items.map((item, index) => {
            const upload = uploadOf(item.id);
            const percent = Math.round(upload.progress * 100);
            const isSelected = item.id === selectedId;
            const failed = upload.status === 'failed';
            return (
              <li
                key={item.id}
                draggable
                onDragStart={() => setDragged(index)}
                onDragOver={e => {
                  if (dragged === null) return;
                  e.preventDefault();
                  if (dragged !== index) {
                    onMove(dragged, index);
                    setDragged(index);
                  }
                }}
                onDragEnd={() => setDragged(null)}
                className={`ea-mech-thumb relative h-16 w-16 shrink-0 ${dragged === index ? 'opacity-50' : ''}`}
                data-media-upload={upload.status}
                data-compose-thumb={isSelected ? 'selected' : ''}
              >
                <div className="absolute inset-0 overflow-hidden rounded-xl" style={{ backgroundColor: 'var(--mech-recess)' }}>
                  {item.type === 'image' ? (
                    <MediaTile src={item.url} kind="image" alt="" className="h-full w-full" sizes="64px" />
                  ) : (
                    // The frame stays `ready`: this strip draws one upload state for photos and videos alike.
                    <VideoFrame src={item.url} poster={item.posterUrl} compact onLoadedMetadata={(e: SyntheticEvent<HTMLVideoElement>) => onVideoMeta(item.id, e.currentTarget)} alt="" className="h-full w-full" sizes="64px" />
                  )}
                </div>

                {/* Select: the whole thumbnail. */}
                <button
                  type="button"
                  onClick={() => onSelect(isSelected ? null : item.id)}
                  aria-pressed={isSelected}
                  aria-label={`${item.type === 'video' ? 'Video' : 'Photo'} ${index + 1}${index === 0 ? ', cover' : ''}`}
                  className="ea-mech-thumb-ring absolute inset-0 rounded-xl"
                  data-selected={isSelected ? '' : undefined}
                  data-compose-select=""
                />

                <span aria-hidden="true" className="ea-mech-readout pointer-events-none absolute left-1 top-1 rounded px-1 text-[9px] leading-[14px] text-white" style={{ backgroundColor: 'var(--mech-cover-tag)' }}>
                  {index + 1}
                </span>
                {item.type === 'video' && upload.status !== 'pending' && !failed && (
                  <span aria-hidden="true" className="pointer-events-none absolute bottom-1 right-1 inline-flex h-4 w-4 items-center justify-center rounded-full text-white" style={{ backgroundColor: 'var(--mech-cover-tag)' }}>
                    <PlayMark size={9} />
                  </span>
                )}
                {index === 0 && (
                  <span className="ea-mech-readout pointer-events-none absolute bottom-1 left-1 rounded px-1 text-[8px] leading-[13px] tracking-[0.08em]" style={{ backgroundColor: 'var(--mech-cover-tag)', color: 'var(--mech-gold)' }} data-compose-cover="">
                    COVER
                  </span>
                )}

                {upload.status === 'pending' && (
                  <div
                    role="progressbar"
                    aria-label="Upload progress"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={percent}
                    className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl"
                    style={{ backgroundColor: 'var(--mech-veil)' }}
                  >
                    <svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true" focusable="false" className="-rotate-90">
                      <circle cx="14" cy="14" r="12.5" fill="none" stroke="var(--mech-outline)" strokeWidth="3" />
                      <circle cx="14" cy="14" r="12.5" fill="none" stroke="var(--mech-media)" strokeWidth="3" strokeLinecap="round" strokeDasharray={RING} strokeDashoffset={RING * (1 - upload.progress)} style={{ transition: 'stroke-dashoffset 200ms linear' }} />
                    </svg>
                  </div>
                )}
                {failed && (
                  <button
                    type="button"
                    onClick={() => onRetry(item.id)}
                    aria-label="Retry upload"
                    data-media-retry=""
                    data-failed=""
                    className="ea-mech-thumb-ring absolute inset-0 flex items-center justify-center rounded-xl text-white"
                    style={{ backgroundColor: 'var(--mech-bad-veil)' }}
                  >
                    <RetryIcon size={20} />
                  </button>
                )}
                {item.tooLong && (
                  <span role="status" className="sr-only">Too long — trim in the editor</span>
                )}
                {item.willProcess && !item.tooLong && (
                  <span role="status" className="sr-only" data-media-will-process="">Will process after posting</span>
                )}

                {/* Remove: a 20 px circle on the corner, a 28 px touch area. */}
                <button
                  type="button"
                  onClick={() => onRemove(item.id)}
                  aria-label="Remove media"
                  className="ea-mech-btn absolute -right-2 -top-2 inline-flex h-7 w-7 items-center justify-center"
                >
                  <span aria-hidden="true" className="inline-flex h-5 w-5 items-center justify-center rounded-full" style={{ backgroundColor: 'var(--mech-close)', color: 'var(--mech-close-icon)', boxShadow: '0 0 0 2px var(--mech-surface)' }}>
                    <CloseIcon size={11} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* What the selected thumbnail's state means, in words (a consequence
          line, not an explanation: it stays visible). */}
      {selected && (selected.tooLong || selected.willProcess) && (
        <p className="mt-1 text-xs font-medium" style={{ color: selected.tooLong ? 'var(--mech-danger)' : 'var(--mech-text-soft)' }} data-compose-media-note="">
          {selected.tooLong ? 'Too long — trim in the editor' : 'Will process after posting'}
        </p>
      )}

      {selected && (
        <div className="mt-2 grid grid-cols-4 gap-1.5" role="group" aria-label={`Edit ${selected.type === 'video' ? 'video' : 'photo'} ${selectedIndex + 1}`} data-compose-edit="">
          {selected.type === 'image' ? (
            <>
              <EditKey label="Crop" hook="crop" disabled={!selected.editable} onClick={() => onEdit(selected.id, 'crop')}><CropIcon size={16} /></EditKey>
              <EditKey label="Adjust" hook="adjust" disabled={!selected.editable} onClick={() => onEdit(selected.id, 'adjust')}><AdjustIcon size={16} /></EditKey>
              <EditKey label="Filter" hook="filter" disabled={!selected.editable} onClick={() => onEdit(selected.id, 'filter')}><FilterIcon size={16} /></EditKey>
            </>
          ) : (
            // A video has no Adjust or Filter in the editor: one Edit key (trim, crop, its own cover frame).
            <div className="col-span-3 grid">
              <EditKey label="Edit" hook="edit" disabled={!selected.editable} onClick={() => onEdit(selected.id)}><CropIcon size={16} /></EditKey>
            </div>
          )}
          <EditKey label="Cover" hook="cover" disabled={selectedIndex === 0} onClick={() => onCover(selected.id)}><CoverIcon size={16} /></EditKey>
        </div>
      )}
    </section>
  );
}

function EditKey({ label, hook, onClick, disabled, children }: { label: string; hook: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-compose-edit-key={hook}
      className="ea-mech-flatkey inline-flex min-h-[44px] min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-0.5 py-1 text-[11px] font-semibold leading-[14px] disabled:opacity-40"
    >
      {/* The icon over the word: four keys hold their words at 320 px and at enlarged text. */}
      <span aria-hidden="true" className="shrink-0 text-[color:var(--mech-accent-light)]">{children}</span>
      <span className="max-w-full whitespace-nowrap">{label}</span>
    </button>
  );
}
