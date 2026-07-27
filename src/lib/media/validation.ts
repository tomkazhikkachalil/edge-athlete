/**
 * Pick-time file validation — the client-side mirror of the server's REAL
 * allowlists (/api/upload/post-media and /api/upload/avatar). Today surfaces
 * check `startsWith('image/')`, which admits HEIC/TIFF/SVG that the server
 * rejects only AFTER a full upload. This module is the single source both
 * sides of that gap converge on.
 *
 * HEIC/HEIF are accepted FOR EDITING (editable: browsers that can decode
 * them — Safari — re-encode to jpeg/webp in the editor, making iPhone HEIC
 * finally uploadable). They are never pass-through: `requiresReencode` marks
 * them, and a browser that can't decode them surfaces a per-asset error in
 * the editor instead of a server rejection after upload.
 */

// Mirrors src/app/api/upload/post-media/route.ts allowlists — keep in sync.
export const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
export const ALLOWED_VIDEO_MIME = ['video/mp4', 'video/quicktime', 'video/webm'] as const;

/** Decodable-by-some-browsers formats the editor converts on export. */
export const REENCODE_ONLY_IMAGE_MIME = ['image/heic', 'image/heif'] as const;

export type RejectionReason = 'type' | 'size' | 'count';

export interface RejectedFile {
  file: File;
  reason: RejectionReason;
  message: string;
}

export interface ValidationRules {
  maxBytes: number;
  allowVideo: boolean;
  maxCount: number;
  /** Files already attached on the surface (counts toward maxCount). */
  existingCount?: number;
}

export interface ValidationResult {
  accepted: File[];
  rejected: RejectedFile[];
}

export function isServerAllowedType(mime: string): boolean {
  return (
    (ALLOWED_IMAGE_MIME as readonly string[]).includes(mime) ||
    (ALLOWED_VIDEO_MIME as readonly string[]).includes(mime)
  );
}

/** True for types the editor must re-encode before upload (never pass-through). */
export function requiresReencode(mime: string): boolean {
  return (REENCODE_ONLY_IMAGE_MIME as readonly string[]).includes(mime);
}

export function mediaKindOf(mime: string): 'image' | 'video' | null {
  if (
    (ALLOWED_IMAGE_MIME as readonly string[]).includes(mime) ||
    (REENCODE_ONLY_IMAGE_MIME as readonly string[]).includes(mime)
  ) {
    return 'image';
  }
  if ((ALLOWED_VIDEO_MIME as readonly string[]).includes(mime)) return 'video';
  return null;
}

function formatBytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))}MB`;
}

export function validateFiles(files: File[], rules: ValidationRules): ValidationResult {
  const accepted: File[] = [];
  const rejected: RejectedFile[] = [];
  let room = Math.max(0, rules.maxCount - (rules.existingCount ?? 0));

  for (const file of files) {
    const kind = mediaKindOf(file.type);
    if (kind === null || (kind === 'video' && !rules.allowVideo)) {
      rejected.push({
        file,
        reason: 'type',
        message:
          kind === 'video'
            ? `${file.name}: videos aren't allowed here`
            : `${file.name}: unsupported format — use JPG, PNG, GIF, WebP${rules.allowVideo ? ', MP4, MOV, or WebM' : ', or WebP'}`,
      });
      continue;
    }
    if (file.size > rules.maxBytes) {
      rejected.push({
        file,
        reason: 'size',
        message: `${file.name}: larger than the ${formatBytes(rules.maxBytes)} limit`,
      });
      continue;
    }
    if (room <= 0) {
      rejected.push({
        file,
        reason: 'count',
        message: `${file.name}: limit of ${rules.maxCount} files reached`,
      });
      continue;
    }
    accepted.push(file);
    room--;
  }

  return { accepted, rejected };
}
