'use client';

import CaptureInputs from '@/components/media/CaptureInputs';
import type { RecordingPhoto } from '@/lib/activities/record/recording';

/**
 * Photos during a recording: a capture is a TILE at once (capture v2) and
 * uploads in the background; no editor here — you are moving. The pencil
 * lives on the activity page after Finish.
 */
export default function RecorderPhotos({
  photos,
  previews,
  disabled,
  onFiles,
  onRemove,
  onRetry,
}: {
  photos: RecordingPhoto[];
  previews: Record<string, string>;
  disabled: boolean;
  onFiles: (files: FileList) => void;
  onRemove: (localId: string) => void;
  onRetry: (localId: string) => void;
}) {
  return (
    <section aria-label="Photos" className="px-4" data-record-photos={photos.length}>
      <div className="flex items-center gap-2 overflow-x-auto py-1">
        <CaptureInputs onFiles={onFiles} allowVideo>
          {({ openPhoto, openVideo }) => (
            <>
              <button type="button" onClick={openPhoto} disabled={disabled} className="ea-icon-btn ea-surface inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-lg text-brand-fg disabled:opacity-50" aria-label="Take a photo" data-record-photo="">
                <i className="fas fa-camera text-xl" aria-hidden="true"></i>
              </button>
              {openVideo && (
                <button type="button" onClick={openVideo} disabled={disabled} className="ea-icon-btn ea-surface inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-lg text-brand-fg disabled:opacity-50" aria-label="Record a clip">
                  <i className="fas fa-video text-xl" aria-hidden="true"></i>
                </button>
              )}
            </>
          )}
        </CaptureInputs>
        {photos.map(p => (
          <div key={p.localId} className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-surface-sunken" data-record-photo-tile={p.failed ? 'failed' : p.url ? 'done' : 'uploading'}>
            {previews[p.localId] ? (
              p.type === 'video' ? (
                <video src={previews[p.localId]} muted playsInline preload="metadata" className="h-full w-full object-cover" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- a local object URL from the camera, not a stored image
                <img src={previews[p.localId]} alt="" className="h-full w-full object-cover" />
              )
            ) : (
              <div className="flex h-full w-full items-center justify-center text-muted"><i className="fas fa-image" aria-hidden="true"></i></div>
            )}
            {!p.url && !p.failed && <span className="absolute inset-x-0 bottom-0 h-1 animate-pulse bg-brand" aria-label="Uploading" />}
            {p.failed && (
              <button type="button" onClick={() => onRetry(p.localId)} className="absolute inset-0 flex items-center justify-center bg-black/50 text-white text-xs font-semibold" aria-label="Retry upload">
                Retry
              </button>
            )}
            <button type="button" onClick={() => onRemove(p.localId)} className="absolute right-0 top-0 flex h-5 w-5 items-center justify-center rounded-bl-lg bg-black/60 text-white" aria-label="Remove photo">
              <i className="fas fa-times text-[10px]" aria-hidden="true"></i>
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
