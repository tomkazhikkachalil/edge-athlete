'use client';

import { useState, useCallback, useRef, useEffect, type ComponentType } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { afterCreatePath } from '@/lib/golf/round-route';
import { refreshDrafts } from '@/hooks/useDrafts';
import { calcPlayerTotals } from '@/lib/golf/scoring';
import { useToast } from '@/components/Toast';
import { getTagOptions, getHashtagSuggestions } from '@/lib/sports/post-tags';
import VideoFrame from '@/components/media/VideoFrame';
import { MAX_DEVICE_POSTER_ATTEMPTS, planPosterRetry, POSTER_GRAB_DEADLINE_MS, POSTER_RETRY_DEADLINE_MS, posterTimeFor, type PosterFailure } from '@/lib/media/poster-plan';
import { useMediaUploadQueue } from '@/components/media/useMediaUploadQueue';
import { grabBlurInto } from '@/components/media/grab-poster';
import { UploadError } from '@/lib/media/upload';
import type { QueueItem } from '@/lib/media/upload-queue';
import MediaTile from '@/components/media/MediaTile';
import TagPeopleModal from '@/components/TagPeopleModal';
import SportSelector from '@/components/SportSelector';
import { type PlayerScoreData } from '@/components/golf/MultiPlayerScorecardGrid';
import SharedRoundQuickView from '@/components/golf/SharedRoundQuickView';
import { defaultGolfComposerValue, type GolfComposerValue } from '@/components/golf/GolfComposerSection';
import { submitSharedRound } from '@/components/golf/shared-round-submit';
import { SPORT_COMPOSER_EXTRAS, type SportComposerExtraProps } from '@/components/sport-composer-extras';
import { getSportDefinition, type SportKey } from '@/lib/sports/SportRegistry';
import StatLineForm, { emptyStatLine, statLineHasContent } from '@/components/StatLineForm';
import { getStatSchema, type StatLineData } from '@/lib/sports/stat-schemas';
import type { CompleteGolfScorecard, ParticipantRole } from '@/types/group-posts';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useDirtyClose } from '@/hooks/useDirtyClose';
import ConfirmModal from '@/components/ConfirmModal';
import { COPY } from '@/lib/copy';
import { MediaEditor, warmEditorChunk } from '@/components/media-editor';
import CaptureInputs from '@/components/media/CaptureInputs';
import { validateFiles } from '@/lib/media/validation';
import { recipeEnvelope } from '@/lib/media/recipes';
import { loadComposerDraft, saveComposerDraft, clearComposerDraft, type ComposerDraft } from '@/lib/posts/composer-draft';
import { attachOriginalInBackground } from '@/lib/media/upload';
import { prepareImageForUpload } from '@/lib/media/post-time-resize';
import { planPickAttach, usableDuration } from '@/lib/media/capture-attach';
import { uploadingLine } from '@/lib/media/upload-progress';
import { MAX_VIDEO_SECONDS } from '@/lib/media/limits';
import type { EditRecipe, EditedMedia, EditorConfig, MediaAsset } from '@/lib/media/types';
import { MAX_UPLOAD_BYTES } from '@/lib/media/upload-rules';
import FeedToggle from '@/components/posts/FeedToggle';
import { readFeedDefault } from '@/lib/posts/feed-memory';
import { POST_VISIBILITY, isPrivateAccount } from '@/lib/posts/audience';

interface CreatePostModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  onPostCreated?: (post: unknown) => void;
  defaultSportKey?: SportKey | 'general'; // Optional: pre-select a sport
  /** Create → Sport (Oct 13 2026): open with the Select Sport picker already
   *  showing. Closing the picker without a pick leaves a General post. */
  openSportPicker?: boolean;
  /** Cross-cutting category stamped on the created post (077) — the Training
   *  tab passes 'training'. Not user-editable in the composer. */
  defaultPostCategory?: 'training';
}

interface MediaFile {
  id: string;
  url: string;
  type: 'image' | 'video';
  size: number;
  file?: File;
  preview?: string;
  /** Original picked file — re-opening the editor starts from this. */
  sourceFile?: File;
  /** The edit that produced `file`; rehydrates the editor on re-edit. */
  recipe?: EditRecipe;
  /** Object URL of `posterBlob`, for an attached video tile's poster (Capture v2). */
  posterPreviewUrl?: string;
  /** Video cover frame from the editor — uploaded as post_media.thumbnail_url. */
  /** undefined = not attempted yet; null = attempted, none (Capture v2 lazy poster). */
  posterBlob?: Blob | null;
  /** Output metadata from the editor's probe — persisted to post_media. */
  width?: number;
  height?: number;
  durationSeconds?: number;
  /** True when `file` is a rendered blob distinct from `sourceFile` — drives
   *  the non-destructive original upload (source_url, migration 120). */
  edited?: boolean;
  /** Device poster grabs so far and why the last one failed (poster-plan.ts). */
  posterAttempts?: number;
  posterFailure?: PosterFailure;
}
// Upload state (pending / failed / stored, the progress, the stored URLs) is
// NOT on MediaFile: the queue (useMediaUploadQueue) is the one truth, read at
// render and at Post through `uploads.itemFor(file.id)` — `file.id` IS the
// queue's localId.

/** The composer's session in the device media stash (the upload queue owns it). */
const COMPOSER_STASH = 'composer';

/** A video tile's VideoFrame state from its queue item (none yet = pending). */
function frameStateOf(item: QueueItem | undefined): 'ready' | 'pending' | 'failed' | 'processing' {
  if (!item) return 'pending';
  if (item.status === 'stored') return 'ready';
  return item.status;
}

function revokePreviews(files: readonly MediaFile[]): void {
  for (const f of files) {
    if (f.preview) URL.revokeObjectURL(f.preview);
    if (f.posterPreviewUrl) URL.revokeObjectURL(f.posterPreviewUrl);
  }
}

// Golf composer state lives in src/components/golf/GolfComposerSection.tsx
// (sport-cleanup D-2; one-flow unification retired the individual scorecard).

// Nullable: these come straight from /api/search, which returns explicit
// nulls for unset name fields.
interface ProfileData {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  name?: string | null;
  avatar_url?: string | null;
}

interface SharedRoundDetails {
  courseName: string;
  date: string;
  holesPlayed: number;
  roundTypeIndoorOutdoor: 'outdoor' | 'indoor';
  teeColor: string;
  weather: string;
  temperature: string;
  wind: string;
}

type PlayerScore = PlayerScoreData;

interface TagOption {
  value: string;
  label: string;
  color: string;
}

interface PostPreviewProps {
  postType: SportKey | 'general';
  caption: string;
  tags: string[];
  hashtags: string[];
  mediaFiles: MediaFile[];
  /** The posting account's visibility — who will see it (audience.ts). */
  accountVisibility: string | null;
  taggedPeople?: {id: string; name: string}[];
  holeParSource?: { hole: number; par: number }[] | null;
  // Round data (one flow — every golf round previews as the shared scorecard)
  sharedRoundDetails?: SharedRoundDetails;
  sharedRoundParticipants?: {id: string; name: string; avatar_url?: string}[];
  playerScores?: PlayerScore[];
  userId?: string;
  onClose: () => void;
  onPost: () => void;
}

// No longer needed - using SportSelector instead

// Tag chips + hashtag suggestions are registry-driven — see
// src/lib/sports/post-tags.ts (per-sport lists live on SportDefinition).

// Sport composer slot entries, resolved once at module scope so the section
// components are identity-stable across renders (a new array per render would
// still reuse elements by key, but there is no reason to rebuild it).
const SPORT_COMPOSER_ENTRIES = Object.entries(SPORT_COMPOSER_EXTRAS) as [
  SportKey,
  ComponentType<SportComposerExtraProps>
][];

export default function CreatePostModal({
  isOpen,
  onClose,
  userId,
  onPostCreated,
  defaultSportKey = 'general',
  openSportPicker = false,
  defaultPostCategory
}: CreatePostModalProps) {
  const { showError } = useToast();
  const router = useRouter();
  const { activeProfile, profile } = useAuth();
  const captionRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Native-camera capture lives in the shared <CaptureInputs> (capture-
  // everywhere round); it feeds the same validate→editor pipeline.

  // Post type and content
  const [postType, setPostType] = useState<SportKey | 'general'>(defaultSportKey);
  const [showSportSelector, setShowSportSelector] = useState(false);

  // The modal stays mounted with isOpen toggling, so the useState initializer
  // above only ever sees the FIRST defaultSportKey. Re-apply it on each open
  // transition (ref-guarded so a prop change mid-composition can't clobber
  // what the user picked).
  // Post to feed (269): a switch, not an audience; remembered per kind on this device.
  const feedKind = defaultPostCategory === 'training' ? 'workout' : 'sport';
  const [onFeed, setOnFeed] = useState(() => readFeedDefault(feedKind));
  const wasOpenRef = useRef(false);
  // Crash-recovery draft (dummy-proofing round): offered back as a notice on
  // open, never silently applied. Deliberate exits (discard confirm, post)
  // clear it; only an unexpected death leaves one behind.
  const [availableDraft, setAvailableDraft] = useState<ComposerDraft | null>(null);
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      // A photo is the likely next step: the editor's chunk loads while the
      // person types, not after they pick (photo → editor speed, Oct 15 2026).
      warmEditorChunk();
      setPostType(defaultSportKey);
      setShowSportSelector(Boolean(openSportPicker));
      setAvailableDraft(loadComposerDraft());
      setOnFeed(readFeedDefault(defaultPostCategory === 'training' ? 'workout' : 'sport'));
    }
    wasOpenRef.current = isOpen;
  }, [isOpen, defaultSportKey, openSportPicker, defaultPostCategory]);

  // Stat-line sports (ice hockey, volleyball, …) — schema-driven stat entry
  const [statLineData, setStatLineData] = useState<StatLineData | null>(null);
  const isStatLineSport = postType !== 'general' && getStatSchema(postType) !== null;
  const [caption, setCaption] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [showHashtagSuggestions, setShowHashtagSuggestions] = useState(false);
  const [customHashtag, setCustomHashtag] = useState('');

  // Media management
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([]);
  const [draggedOver, setDraggedOver] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  // Golf specific data lives in GolfComposerSection (see the sport slot in
  // the JSX below); the section reports its full value up on every internal
  // change, and this snapshot is all the submit, validation, footer-hint and
  // preview paths read.
  const [golfValue, setGolfValue] = useState<GolfComposerValue>(() => defaultGolfComposerValue());
  // G1 (Sep 2026): the crash-draft's golf value, applied by remounting the
  // slot with a seed (the section reads it once as initializers and reports
  // up on mount, so golfValue re-syncs without extra plumbing).
  const [golfSeed, setGolfSeed] = useState<GolfComposerValue | undefined>(undefined);
  // Bumped by reset() — remounts the sport sections so their internal state
  // clears at exactly the moments the old inline golf state was reset
  // (confirmed discard / post success).
  const [sportSectionResetKey, setSportSectionResetKey] = useState(0);

  // Visibility and submission
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  // Shared media editor session (null = closed). editingExistingId set when
  // re-editing an already-attached asset (result replaces it in place).
  const [editorAssets, setEditorAssets] = useState<MediaAsset[] | null>(null);
  const [editingExistingId, setEditingExistingId] = useState<string | null>(null);

  // Persist the recoverable half of the composer while open (storage write
  // only — media Files and the uncontrolled golf section can't ride
  // localStorage; see composer-draft.ts).
  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      saveComposerDraft({
        postType,
        caption,
        hashtags,
        tags: selectedTags,
        visibility,
        // The golf section rides along only while it holds real work (G1).
        ...(golfValue.isDirty ? { golf: golfValue } : {}),
        ...(mediaFiles.length > 0 ? { mediaCount: mediaFiles.length } : {}),
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [isOpen, postType, caption, hashtags, selectedTags, visibility, golfValue, mediaFiles.length]);

  // Tagging people
  const [taggedProfiles, setTaggedProfiles] = useState<string[]>([]);
  const [taggedProfilesData, setTaggedProfilesData] = useState<{id: string; name: string}[]>([]);
  const [showTagModal, setShowTagModal] = useState(false);

  // Character limits
  const MAX_CAPTION_LENGTH = 500;
  const MAX_HASHTAGS = 10;
  const MAX_MEDIA_FILES = 10;

  const COMPOSER_EDITOR_CONFIG: EditorConfig = {
    aspectRatios: ['free', '1:1', '4:5', '9:16', '16:9'],
    allowVideo: true, // trim/split/cover via WebCodecs; degrades to pass-through without it
    maxAssets: MAX_MEDIA_FILES,
    output: { maxDimension: 2048, mime: 'image/jpeg', quality: 0.9 },
  };

  // THE upload queue (video posters PR 2, Oct 13 2026): a tile's bytes leave
  // the device from the moment it is attached — one at a time, in the
  // background, with progress on the tile, a Retry on failure that keeps the
  // file, a retry by itself when the connection returns; Post waits on
  // `settle()`. The bytes sit in the IndexedDB stash meanwhile (crash
  // recovery — the Oct 10 draft offer restores them). A photo the person
  // never edited is resized to the composer's cap in the queue's prepare
  // step (C4 — on the device chain, AFTER the tile, never on the attach
  // path); its original follows after the post exists, like an edited
  // video's. The ids the editor minted are tracked so an edited render is
  // never resized again.
  const editedIdsRef = useRef<Set<string>>(new Set());
  const uploads = useMediaUploadQueue({
    sessionId: COMPOSER_STASH,
    // The bytes stay until Post or a discard: a reload before Post rebuilds
    // the tiles from them (the Oct 10 draft offer) — the stored URL lives
    // only in memory.
    keepStashedAfterUpload: true,
    // Acting-as: media belongs to the athlete's post, so it lands under the
    // ATHLETE's storage prefix (the server validates via the acting-as gate).
    targetProfileId: () => activeProfile?.id,
    prepare: async (file, localId) => {
      if (editedIdsRef.current.has(localId) || !file.type.startsWith('image/')) return null;
      const prepared = await prepareImageForUpload(file, COMPOSER_EDITOR_CONFIG.output);
      return { file: prepared.file, original: prepared.resized ? prepared.original : undefined, width: prepared.width, height: prepared.height };
    },
    // A photo's blur (PR 6): from its STORED render (the prepare step made it
    // small), enqueued INSIDE the upload task so Post's `settle()` waits for
    // it — a React effect ran a render too late and a Post sent the instant
    // the upload landed went out without it. A clip's blur is its poster's.
    onStored: (item, q) => {
      if (item.kind !== 'image') return;
      const picture = q.fileFor(item.localId);
      if (picture) grabBlurInto(q, item.localId, picture);
    },
    notify: showError,
  });
  const queue = uploads.queue;
  // While the editor is open the queue's device work (the post-time resize,
  // a blur grab) waits: the editor's own decode gets the CPU, and an edit
  // replaces the resized bytes anyway (photo → editor speed, Oct 15 2026).
  const editorOpen = editorAssets !== null;
  useEffect(() => {
    if (!editorOpen) return;
    return queue.holdDevice();
  }, [editorOpen, queue]);
  const clearComposerStash = () => queue.clearStash();
  const restoreStashedMedia = async () => {
    const { restored } = await queue.resumeFromStash();
    if (restored.length === 0) return;
    setMediaFiles(prev => {
      const have = new Set(prev.map(m => m.id));
      const room = Math.max(0, MAX_MEDIA_FILES - prev.length);
      const fresh = restored
        .filter(r => !have.has(r.item.localId))
        .slice(0, room)
        .map(({ item, file }): MediaFile => {
          const objectUrl = queue.previewFor(item.localId) ?? URL.createObjectURL(file);
          return { id: item.localId, url: objectUrl, type: item.kind, size: file.size, file, preview: objectUrl, sourceFile: file, edited: false };
        });
      return fresh.length ? [...prev, ...fresh] : prev;
    });
  };

  // Reset form (back to the caller's default sport, not hardcoded 'general' —
  // resetting to 'general' silently dropped every caller's defaultSportKey
  // after the first post)
  const reset = () => {
    setPostType(defaultSportKey);
    setCaption('');
    setSelectedTags([]);
    setHashtags([]);
    revokePreviews(mediaFiles);
    setMediaFiles([]);
    setStatLineData(null);
    setVisibility('public');
    setShowHashtagSuggestions(false);
    setCustomHashtag('');
    setShowPreview(false);
    setTaggedProfiles([]);
    setTaggedProfilesData([]);
    setShowTagModal(false);
    // Reset ALL golf state (shared round data, course search, hole data,
    // score entry): restore the reported snapshot to its default and remount
    // the sport sections so their internal state starts fresh.
    setGolfValue(defaultGolfComposerValue());
    setGolfSeed(undefined);
    setSportSectionResetKey(k => k + 1);
  };

  // Close-and-reset, used directly by post-success paths (never confirm
  // after a save). User-initiated closes (X, Cancel) go through
  // requestClose below, which asks before discarding unsaved work.
  const closeAndReset = () => {
    // Explicit exit (confirmed discard or successful post) — the draft's job
    // is crash recovery, not resurrecting decisions.
    clearComposerDraft();
    clearComposerStash();
    queue.forgetAll();
    setAvailableDraft(null);
    reset();
    onClose();
  };

  // Anything reset() would throw away counts as unsaved work — an
  // 18-hole scorecard is the most painful loss this modal can inflict.
  const isDirty = () =>
    caption.trim() !== '' ||
    mediaFiles.length > 0 ||
    selectedTags.length > 0 ||
    hashtags.length > 0 ||
    customHashtag.trim() !== '' ||
    taggedProfiles.length > 0 ||
    statLineData !== null ||
    // Golf's share (scorecard, course, participants, manual pars, scores) is
    // computed in GolfComposerSection.
    golfValue.isDirty;

  const { requestClose, confirmOpen, confirmDiscard, cancelDiscard } = useDirtyClose(isDirty, closeAndReset);

  // Picked files go through the shared media editor before joining the post.
  // Validation now mirrors the server allowlist AT PICK (HEIC no longer fails
  // after a full upload — it re-encodes in the editor), and the size cap
  // matches the server's 50MB (edited images re-encode far smaller anyway).
  //
  // CAPTURE V2 (Sep 2026): a CAMERA capture attaches immediately as a tile —
  // the original File is the tile and the upload; the editor is one tap away
  // (the tile's Edit button), never mandatory. Nothing heavy runs between the
  // camera's hand-back and the tile (capture-attach.ts explains why). Since
  // Oct 4 2026 a LIBRARY video attaches the same way (the editor on a long
  // library video is where "uploading is slow" came from); library photos
  // keep the editor-first flow. HEIC still opens the editor.
  const handleFileUpload = useCallback((files: FileList | File[], source: 'camera' | 'library' = 'library') => {
    if (files.length === 0) return;
    const { accepted, rejected } = validateFiles(Array.from(files), {
      maxBytes: MAX_UPLOAD_BYTES,
      allowVideo: true,
      maxCount: MAX_MEDIA_FILES,
      existingCount: mediaFiles.length,
    });
    for (const r of rejected) {
      showError('File not added', r.message);
    }
    if (accepted.length === 0) return;
    const toAsset = (file: File) => ({
      id: `${Date.now()}-${Math.random()}`,
      file,
      kind: file.type.startsWith('video/') ? 'video' as const : 'image' as const,
    });
    {
      const { attach, editor } = planPickAttach(accepted, source);
      if (attach.length > 0) {
        // The tile first; the queue starts the upload on a microtask.
        const items = queue.register(attach);
        setMediaFiles(prev => [
          ...prev,
          ...attach.map((file, i): MediaFile => {
            const item = items[i];
            const objectUrl = queue.previewFor(item.localId) ?? URL.createObjectURL(file);
            return {
              id: item.localId,
              url: objectUrl,
              type: item.kind,
              size: file.size,
              file,
              preview: objectUrl,
              sourceFile: file,
              edited: false,
            };
          }),
        ]);
      }
      if (editor.length === 0) return;
      setEditingExistingId(null);
      setEditorAssets(editor.map(toAsset));
    }
  }, [mediaFiles.length, queue, showError]);

  // Capture v2: an attached video's own <video preload="metadata"> reports its
  // size and duration for free — no extra probe load. MediaRecorder files say
  // Infinity until seeked; that reads as "unknown", never as "too long".
  const noteVideoMeta = (id: string, el: HTMLVideoElement) => {
    const duration = usableDuration(el.duration);
    setMediaFiles(prev =>
      prev.map(f => {
        if (f.id !== id || f.width) return f;
        return {
          ...f,
          width: el.videoWidth || undefined,
          height: el.videoHeight || undefined,
          durationSeconds: duration ?? f.durationSeconds,
        };
      })
    );
  };
  const hasTooLongVideo = mediaFiles.some(f => f.type === 'video' && (f.durationSeconds ?? 0) > MAX_VIDEO_SECONDS);

  // Capture v2: a poster for an attached video, AFTER the tile is on screen,
  // one at a time, with a deadline — never on the path to the tile. A miss
  // leaves the tile on its own first frame and the post without a thumbnail.
  // The poster plan (poster-plan.ts): a timeout grabs once more after the
  // main upload landed (the device is idle then), a decode failure (Android +
  // an HEVC clip) leaves the poster to the server job at once.
  const posterInFlightRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (posterInFlightRef.current.size > 0) return;
    const candidate = mediaFiles.find(f => {
      if (f.type !== 'video' || f.edited || !f.sourceFile) return false;
      if (f.posterBlob === undefined) return true;
      if (f.posterBlob !== null || f.posterFailure === 'decode') return false;
      const attempts = f.posterAttempts ?? 0;
      return attempts < MAX_DEVICE_POSTER_ATTEMPTS && uploads.itemFor(f.id)?.status === 'stored';
    });
    if (!candidate || !candidate.sourceFile) return;
    const id = candidate.id;
    const source = candidate.sourceFile;
    const attempt = (candidate.posterAttempts ?? 0) + 1;
    const deadline = attempt === 1 ? POSTER_GRAB_DEADLINE_MS : POSTER_RETRY_DEADLINE_MS;
    posterInFlightRef.current.add(id);
    let settled = false;
    const finish = (blob: Blob | null, failure?: PosterFailure) => {
      if (settled) return;
      settled = true;
      posterInFlightRef.current.delete(id);
      if (blob) {
        queue.attachPoster(id, blob);
        grabBlurInto(queue, id, blob); // the clip's blur is its poster's (PR 6)
      }
      const plan = blob ? null : planPosterRetry(attempt, failure ?? 'timeout');
      setMediaFiles(prev =>
        prev.map(f =>
          f.id === id && (f.posterBlob === undefined || f.posterBlob === null)
            ? {
                ...f,
                posterBlob: blob ?? null,
                posterPreviewUrl: blob ? URL.createObjectURL(blob) : undefined,
                posterAttempts: attempt,
                posterFailure: blob ? undefined : plan?.action === 'server' ? 'decode' : failure ?? 'timeout',
              }
            : f
        )
      );
    };
    const timer = setTimeout(() => finish(null, 'timeout'), deadline);
    void import('@/lib/media/poster')
      .then(({ capturePoster }) => capturePoster(source, posterTimeFor(candidate.durationSeconds)))
      .then(blob => finish(blob))
      .catch(err => finish(null, err && typeof err === 'object' && 'failure' in err ? (err as { failure: PosterFailure }).failure : 'canvas'))
      .finally(() => clearTimeout(timer));
  }, [mediaFiles, uploads, queue]);

  // Editor finished: append new assets, or swap the re-edited one in place
  const handleEditorDone = (results: EditedMedia[]) => {
    const toMediaFile = (r: EditedMedia): MediaFile => ({
      id: r.id,
      url: r.previewUrl,
      type: r.kind,
      size: r.file.size,
      file: r.file,
      preview: r.previewUrl,
      sourceFile: r.sourceFile,
      recipe: r.recipe,
      posterBlob: r.posterBlob,
      // The editor's cover (a chosen frame, PR 4 a photo) is the tile's poster at once.
      posterPreviewUrl: r.posterBlob ? URL.createObjectURL(r.posterBlob) : undefined,
      width: r.width,
      height: r.height,
      durationSeconds: r.durationSeconds,
      edited: r.edited,
    });
    // An edited PHOTO's original rides inline (the recipe and the source land
    // together — media-reedit.spec pins it); an edited VIDEO's follows after
    // the post exists (deferred — see handleSubmit).
    const queueExtras = (localId: string, r: EditedMedia) => {
      if (r.edited) editedIdsRef.current.add(localId);
      if (r.edited && r.sourceFile && r.kind === 'image') queue.attachOriginal(localId, r.sourceFile);
    };
    if (editingExistingId) {
      const replaced = results[0];
      if (replaced) {
        if (replaced.edited) editedIdsRef.current.add(editingExistingId);
        queue.replaceWithEdited(editingExistingId, replaced.file, { previewUrl: replaced.previewUrl, posterBlob: replaced.posterBlob });
        queueExtras(editingExistingId, replaced);
      }
      setMediaFiles(prev =>
        prev.map(f => {
          if (f.id !== editingExistingId || !replaced) return f;
          if (f.preview && f.preview !== replaced.previewUrl) URL.revokeObjectURL(f.preview); // old blob preview
          if (f.posterPreviewUrl) URL.revokeObjectURL(f.posterPreviewUrl);
          return { ...toMediaFile(replaced), id: f.id };
        })
      );
    } else {
      const fresh = results.map(r => {
        const [item] = queue.register([r.file]);
        if (r.edited) editedIdsRef.current.add(item.localId);
        if (r.posterBlob) queue.attachPoster(item.localId, r.posterBlob);
        queueExtras(item.localId, r);
        return { ...toMediaFile(r), id: item.localId };
      });
      setMediaFiles(prev => [...prev, ...fresh]);
    }
    setEditorAssets(null);
    setEditingExistingId(null);
  };

  const openEditorFor = (mediaFile: MediaFile) => {
    const source = mediaFile.sourceFile ?? mediaFile.file;
    if (!source) return; // existing remote media (edit flows) has no File
    setEditingExistingId(mediaFile.id);
    setEditorAssets([{ id: mediaFile.id, file: source, kind: mediaFile.type, recipe: mediaFile.recipe }]);
  };

  // Media drag and drop handlers
  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex !== null && draggedIndex !== index) {
      const newFiles = [...mediaFiles];
      const draggedFile = newFiles[draggedIndex];
      newFiles.splice(draggedIndex, 1);
      newFiles.splice(index, 0, draggedFile);
      setMediaFiles(newFiles);
      setDraggedIndex(index);
    }
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  // Remove media file
  const removeMediaFile = (fileId: string) => {
    const file = mediaFiles.find(f => f.id === fileId);
    queue.forget(fileId); // a landing upload of its bytes is ignored; its stash entry goes
    if (file?.preview) {
      URL.revokeObjectURL(file.preview);
    }
    if (file?.posterPreviewUrl) URL.revokeObjectURL(file.posterPreviewUrl);
    setMediaFiles(prev => prev.filter(f => f.id !== fileId));
  };

  // Toggle tag selection
  const toggleTag = (tagValue: string) => {
    setSelectedTags(prev =>
      prev.includes(tagValue)
        ? prev.filter(t => t !== tagValue)
        : [...prev, tagValue]
    );
  };

  // Add hashtag
  const addHashtag = (hashtag: string) => {
    const formattedHashtag = hashtag.startsWith('#') ? hashtag : `#${hashtag}`;
    if (hashtags.length < MAX_HASHTAGS && !hashtags.includes(formattedHashtag)) {
      setHashtags(prev => [...prev, formattedHashtag]);
    }
  };

  // Remove hashtag
  const removeHashtag = (hashtag: string) => {
    setHashtags(prev => prev.filter(h => h !== hashtag));
  };

  // Handle tag people selection
  const handleTagPeopleComplete = (selectedIds: string[], selectedProfiles?: ProfileData[]) => {
    setTaggedProfiles(selectedIds);

    // Use the profile data passed from the modal
    if (selectedProfiles && selectedProfiles.length > 0) {
      const profilesData = selectedProfiles.map(profile => {
        const name = profile.first_name && profile.last_name
          ? `${profile.first_name} ${profile.last_name}`
          : profile.full_name || 'Unknown User';
        return { id: profile.id, name };
      });
      setTaggedProfilesData(profilesData);
    }
  };

  // Remove tagged person
  const removeTaggedPerson = (profileId: string) => {
    setTaggedProfiles(prev => prev.filter(id => id !== profileId));
    setTaggedProfilesData(prev => prev.filter(p => p.id !== profileId));
  };

  // Handle custom hashtag input
  const handleCustomHashtagSubmit = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && customHashtag.trim()) {
      e.preventDefault();
      addHashtag(customHashtag.trim());
      setCustomHashtag('');
    }
  };

  // What a tile's upload produced (video posters PR 2): the queue uploaded
  // the render (resized at Post-time for an unedited photo), its poster and an
  // edited photo's original from the moment it was attached; here we WAIT
  // for the item and read the URLs. A failed item throws — Post stops and
  // the tile's Retry is the way on. The original that waits for the post:
  // an edited VIDEO's source, or the post-time resize's original.
  const uploadedFor = async (
    mediaFile: MediaFile
  ): Promise<{ url: string; thumbnailUrl?: string; sourceUrl?: string; deferredOriginal?: File; item?: QueueItem }> => {
    if (!mediaFile.file) return { url: mediaFile.url };
    const item = await queue.waitFor(mediaFile.id);
    if (item.status === 'failed' || !item.storedUrl) {
      throw new UploadError(item.failure?.kind ?? 'refused', 'A file did not upload — tap Retry on it, or remove it');
    }
    const deferredOriginal =
      mediaFile.edited && mediaFile.type === 'video' ? mediaFile.sourceFile : queue.originalFor(mediaFile.id) ?? undefined;
    return { url: item.storedUrl, thumbnailUrl: item.posterUrl, sourceUrl: item.sourceUrl, deferredOriginal, item };
  };

  // Validation
  const isValidForSubmission = () => {
    // Capture v2: a video over the cap waits for a trim (the tile says so).
    if (hasTooLongVideo) return false;
    // General posts need either caption or media
    if (postType === 'general') {
      return caption.trim().length > 0 || mediaFiles.length > 0;
    }

    // Stat-line sports: postable with a caption, media, or any entered stats
    if (isStatLineSport) {
      return (
        caption.trim().length > 0 ||
        mediaFiles.length > 0 ||
        (statLineData !== null && statLineHasContent(statLineData))
      );
    }

    // Golf posts — the branch details (individual scorecard vs shared round
    // requirements) moved verbatim into GolfComposerSection, which reports
    // the same result up as `isValid`
    if (postType === 'golf') {
      return golfValue.isValid;
    }

    return false;
  };

  // Submit post
  const handleSubmit = async () => {
    if (!isValidForSubmission()) {
      // Provide specific error message based on post type
      if (postType === 'golf') {
        const { sharedRoundDetails } = golfValue;
        const missing: string[] = [];
        if (!sharedRoundDetails.courseName.trim()) missing.push('course name');
        if (!sharedRoundDetails.date) missing.push('date');
        // Course + date only — weather/temperature/wind are OPTIONAL (this
        // hint used to name them even though isValid never required them).
        showError('Incomplete round', `Please provide: ${missing.join(', ')}`);
      } else {
        showError('Incomplete post', 'Please add content to your post');
      }
      return;
    }

    setIsSubmitting(true);

    try {

      // EVERY golf round rides the group-posts rails (flow unification —
      // the individual golf_rounds create path is retired; "individual" is
      // a round with zero invitees).
      if (postType === 'golf') {
        // The whole fork — atomic round create, initial scores, media attach,
        // success toasts — lives in shared-round-submit.ts (sport-cleanup
        // D-2). Throws on round-create failure, landing in the catch below.
        const groupPost = await submitSharedRound(golfValue, {
          caption,
          visibility: POST_VISIBILITY,
          mediaFiles,
          uploadMediaWithPoster: uploadedFor,
          showError,
          // Guardian "Posting as": the composer seeds the ATHLETE's identity
          // (GolfComposerSection displayProfile) — the server must agree.
          targetProfileId: activeProfile?.id ?? null,
        });

        // Parents still do their refresh work — the user comes back to that
        // page later, and an abandoned refetch is harmless.
        if (onPostCreated) {
          onPostCreated(groupPost);
        }

        closeAndReset();

        // Going live goes INTO the round. This decision lives HERE, at the one
        // point a round is created, rather than in a parent's onPostCreated —
        // which is why it previously worked on /feed and nowhere else: three
        // pages mount this composer and the app header funnels most routes to
        // /athlete, whose handler never got it. router.push does not care which
        // page mounted us, so all three are fixed and a fourth cannot drift.
        // An already-played round is a DRAFT (253): land on it to review and
        // post — it is not on the feed until then.
        const nextPath = afterCreatePath(groupPost);
        // A round in progress (or an already-played draft) exists now: the
        // resume pill and the Drafts count learn it without a reload.
        void refreshDrafts();
        if (nextPath) router.push(nextPath);
        return;
      }

      // The uploads ran from attach (the queue); Post waits for the queue to
      // drain and refuses while a tile is failed — nothing already uploaded
      // is lost on a failed Post: the queue keeps the stored URLs.
      const settled = await queue.settle();
      if (settled.failed > 0) {
        showError('A file did not upload', 'Tap Retry on it, or remove it, then post.');
        return;
      }
      const uploadedMedia: Array<MediaFile & { thumbnailUrl?: string; sourceUrl?: string; blurHash?: string; codec?: string }> = [];
      // An edited video's ORIGINAL (and a resized photo's) follows after the
      // post exists (by index — the server orders post_media by the sortOrder
      // sent below).
      const deferredOriginals: Array<{ index: number; file: File }> = [];
      for (const [index, file] of mediaFiles.entries()) {
        const { url, thumbnailUrl, sourceUrl, deferredOriginal, item } = await uploadedFor(file);
        uploadedMedia.push({
          ...file,
          url,
          thumbnailUrl,
          sourceUrl,
          blurHash: item?.blurHash,
          codec: item?.codec,
          width: item?.prepared?.width ?? file.width,
          height: item?.prepared?.height ?? file.height,
          edited: file.edited || !!item?.prepared?.resized,
        });
        if (deferredOriginal) deferredOriginals.push({ index, file: deferredOriginal });
      }

      // Prepare post data (userId comes from auth)
      const postData = {
        postType,
        caption: caption.trim(),
        tags: selectedTags,
        hashtags,
        // The account decides who sees it (src/lib/posts/audience.ts); the feed is a switch (269).
        visibility: POST_VISIBILITY,
        onFeed,
        media: uploadedMedia.map((file, index) => ({
          url: file.url,
          type: file.type,
          sortOrder: index,
          // server persists as post_media.thumbnail_url (posts/route.ts)
          thumbnailUrl: file.thumbnailUrl,
          // the blurred placeholder (261) the device computed, when it did
          blurHash: file.blurHash,
          // the codec the server read at completion (PR 7) — an iPhone HEVC clip is marked processing until the worker converts it
          codec: file.codec,
          // editor-probed output metadata → post_media.width/height/duration
          width: file.width,
          height: file.height,
          duration: file.durationSeconds,
          // Non-destructive (120): untouched original + the recipe that made
          // the render. Null sourceUrl ⇒ media_url IS the original.
          sourceUrl: file.sourceUrl,
          editRecipe: file.recipe && file.edited ? recipeEnvelope(file.recipe) : null,
        })),
        stats_data:
          isStatLineSport && statLineData && statLineHasContent(statLineData)
            ? statLineData
            : undefined,
        taggedProfiles: taggedProfiles, // Add tagged people
        // Cross-cutting category (077) — e.g. the Training tab's training posts.
        ...(defaultPostCategory ? { postCategory: defaultPostCategory } : {}),
        // Guardian-profiles: post to the acting-as athlete's profile.
        // Server re-authorizes (guardian row + approved consent).
        ...(activeProfile ? { targetProfileId: activeProfile.id } : {}),
      };


      // Create post
      const response = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // Important: include cookies for authentication
        body: JSON.stringify(postData)
      });


      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create post');
      }

      const result = await response.json();

      // The originals leave the device in the background — the post is
      // already up; a closed tab means re-edit starts from the render.
      const createdMedia: Array<{ id: string }> = Array.isArray(result.post?.media) ? result.post.media : [];
      for (const { index, file } of deferredOriginals) {
        const mediaId = createdMedia[index]?.id;
        if (mediaId) void attachOriginalInBackground(result.post.id, mediaId, file, activeProfile?.id);
      }


      // Call callback to refresh posts
      if (onPostCreated) {
        onPostCreated(result.post);
      }

      // Close modal
      closeAndReset();
    } catch (e) {
      console.error('Failed to create post:', e);
      // Surface the server's reason — "Parental consent must be approved…"
      // as a bare "Please try again" was an unfixable dead end for guardians.
      showError('Failed to create post', e instanceof Error && e.message !== 'Failed to create post' ? e.message : 'Please try again');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Release the previews on unmount only. (The effect used to depend on
  // mediaFiles, so attaching a second file revoked the FIRST file's preview
  // while it was still on screen.) Removal, replacement and reset revoke their own.
  const mediaFilesRef = useRef(mediaFiles);
  useEffect(() => {
    mediaFilesRef.current = mediaFiles;
  }, [mediaFiles]);
  useEffect(() => () => revokePreviews(mediaFilesRef.current), []);

  // Lock background scroll while open (iOS scroll-chaining behind overlays)
  useBodyScrollLock(isOpen);

  if (!isOpen) return null;

  const currentTags = getTagOptions(postType);
  const currentHashtags = getHashtagSuggestions(postType);

  // "Playing now" is round SETUP, not a post: course, partners, conditions,
  // then Go Live. Caption/media/tags belong to the story told when the round
  // completes — hidden during setup (see the section wrappers below).
  const isLiveSetup = postType === 'golf' && !golfValue.sharedRoundDetails.alreadyPlayed;

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
      <div className="bg-surface-raised rounded-lg shadow-xl max-w-4xl w-full max-h-modal flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-6 border-b border-border">
          <h2 className="text-2xl font-bold text-primary">Create Post</h2>
          <button
            onClick={requestClose}
            className="ea-icon-btn inline-flex items-center justify-center"
            aria-label="Close modal"
          >
            <i className="fas fa-times text-muted text-lg"></i>
          </button>
        </div>

        {/* Content - Scrollable */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {/* Crash-recovery draft notice — restore is a choice, never automatic */}
          {availableDraft && caption.trim() === '' && (
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-violet-200 dark:border-violet-800 bg-brand-soft px-3 py-2">
              <i className="fas fa-clock-rotate-left text-brand-fg" aria-hidden="true"></i>
              <p className="text-sm text-violet-900 dark:text-violet-200 flex-1 min-w-40">
                You have an unfinished post{availableDraft.caption ? ` — “${availableDraft.caption.slice(0, 40)}${availableDraft.caption.length > 40 ? '…' : ''}”` : ''}
                {availableDraft.mediaCount ? ` (${availableDraft.mediaCount} ${availableDraft.mediaCount === 1 ? 'photo or video' : 'photos or videos'})` : ''}
              </p>
              <button
                type="button"
                onClick={() => {
                  setCaption(availableDraft.caption);
                  setHashtags(availableDraft.hashtags);
                  setSelectedTags(availableDraft.tags);
                  setVisibility(availableDraft.visibility);
                  if (availableDraft.postType !== postType) {
                    setPostType(availableDraft.postType as SportKey | 'general');
                  }
                  if (availableDraft.golf) {
                    // Remount the slot with the seed; the section reports
                    // the seeded value up on mount (G1).
                    setGolfSeed(availableDraft.golf);
                    setSportSectionResetKey(k => k + 1);
                  }
                  if (availableDraft.mediaCount) void restoreStashedMedia();
                  setAvailableDraft(null);
                }}
                className="min-h-[44px] px-3 rounded-full bg-brand text-white text-sm font-semibold hover:bg-brand-hover"
              >
                Restore
              </button>
              <button
                type="button"
                onClick={() => {
                  clearComposerDraft();
                  clearComposerStash();
                  setAvailableDraft(null);
                }}
                className="min-h-[44px] px-3 rounded-full text-sm font-medium text-secondary hover:bg-surface-sunken"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Media Upload. The whole section is an INVISIBLE drop target
              (dropzone-box retired, Tom Aug 25 — the capture row already
              names every input path): dragging files over it summons a ring
              + "Drop to add"; at rest there's no drag furniture at all.
              Files-only guards keep the preview grid's tile-reorder drags
              from triggering it. */}
          <div
            className={`${isLiveSetup ? 'hidden' : 'mb-6'} ${
              draggedOver ? 'ring-2 ring-violet-500 rounded-lg bg-brand-soft p-2 -m-2' : ''
            }`}
            onDrop={(e) => {
              e.preventDefault();
              setDraggedOver(false);
              if (e.dataTransfer.files?.length) handleFileUpload(e.dataTransfer.files);
            }}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes('Files')) return;
              e.preventDefault();
              setDraggedOver(true);
            }}
            onDragLeave={(e) => {
              // Leaving INTO a child also fires dragleave — ignore those.
              if (e.currentTarget.contains(e.relatedTarget as Node)) return;
              setDraggedOver(false);
            }}
          >
            <label className="block text-sm font-semibold text-secondary mb-3">
              Media ({mediaFiles.length}/{MAX_MEDIA_FILES})
            </label>

            {/* Capture row — media is the headline act (Tom, Aug 24): take it
                NOW at full native-camera quality, or upload. `capture` is a
                mobile hint; on desktop these open the file picker. */}
            <CaptureInputs onFiles={files => handleFileUpload(files, 'camera')} allowVideo>
              {({ openPhoto, openVideo }) => (
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept="image/*,video/*"
                    className="hidden"
                    onClick={(e) => { (e.target as HTMLInputElement).value = ''; }}
                    onChange={(e) => e.target.files && handleFileUpload(e.target.files)}
                  />
                  <button
                    type="button"
                    onClick={openPhoto}
                    className="flex flex-col items-center justify-center gap-1 min-h-[64px] rounded-lg border-2 border-border-strong hover:border-violet-500 hover:bg-brand-soft transition-all text-secondary"
                  >
                    <i className="fas fa-camera text-lg text-brand-fg" aria-hidden="true"></i>
                    <span className="text-xs font-semibold">Take photo</span>
                  </button>
                  <button
                    type="button"
                    onClick={openVideo}
                    className="flex flex-col items-center justify-center gap-1 min-h-[64px] rounded-lg border-2 border-border-strong hover:border-violet-500 hover:bg-brand-soft transition-all text-secondary"
                  >
                    <i className="fas fa-video text-lg text-brand-fg" aria-hidden="true"></i>
                    <span className="text-xs font-semibold">Record video</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex flex-col items-center justify-center gap-1 min-h-[64px] rounded-lg border-2 border-border-strong hover:border-violet-500 hover:bg-brand-soft transition-all text-secondary"
                  >
                    <i className="fas fa-cloud-upload-alt text-lg text-brand-fg" aria-hidden="true"></i>
                    <span className="text-xs font-semibold">Upload</span>
                  </button>
                </div>
              )}
            </CaptureInputs>

            <p className={`text-xs ${draggedOver ? 'font-semibold text-brand-fg' : 'text-muted'}`}>
              {draggedOver
                ? 'Drop to add'
                : 'Up to 50MB each — crop, adjust, and filter before posting'}
            </p>

            {/* Visible privacy care for minors' media (Family Console Wave 1;
                video joined in Wave 6 — MP4/MOV re-muxed on upload, fail-open
                like photos, so the plain claim is honest). */}
            {mediaFiles.length > 0 && (activeProfile || profile?.supervision_state === 'supervised') && (
              <p className="mt-1 text-xs text-muted">
                <i className="fas fa-shield-alt mr-1" aria-hidden="true"></i>
                Location data is removed from photos and videos before upload.
              </p>
            )}

            {/* Media preview grid */}
            {mediaFiles.length > 0 && (
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {mediaFiles.map((file, index) => (
                  <div
                    key={file.id}
                    draggable
                    onDragStart={() => handleDragStart(index)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDragEnd={handleDragEnd}
                    className={`relative aspect-square bg-surface-sunken rounded-lg overflow-hidden cursor-move ${
                      draggedIndex === index ? 'opacity-50' : ''
                    }`}
                    data-media-upload={uploads.itemFor(file.id)?.status ?? (file.file ? 'pending' : 'stored')}
                  >
                    {/* Media number badge */}
                    <div className="absolute top-2 left-2 bg-black/60 text-white text-xs px-2 py-1 rounded">
                      {index + 1}
                    </div>

                    {/* Media content. MediaTile (fill-in-frame), not LazyImage
                        with pixel dimensions: LazyImage bakes its width/height
                        into an inline style that beats Tailwind, so a 200px
                        image was clipped to the top-left corner of the ~114px
                        grid cell on phones. MediaTile also handles the
                        isOptimizableImageSrc opt-out for blob: preview URLs. */}
                    {file.type === 'image' ? (
                      <MediaTile
                        src={file.url}
                        kind="image"
                        alt=""
                        className="h-full w-full"
                        sizes="(max-width: 640px) 45vw, (max-width: 768px) 30vw, 200px"
                      />
                    ) : (
                      <>
                        {/* Capture v2: the local file previews itself (metadata
                            only, muted, inline) until its poster arrives; the
                            element's own metadata fills width/height/duration
                            (no probe load). VideoFrame since Oct 13 2026. */}
                        <VideoFrame
                          src={file.url}
                          poster={file.posterPreviewUrl}
                          state={frameStateOf(uploads.itemFor(file.id))}
                          progress={uploads.itemFor(file.id)?.progress}
                          onRetry={() => queue.retry(file.id)}
                          onLoadedMetadata={e => noteVideoMeta(file.id, e.currentTarget)}
                          alt=""
                          className="w-full h-full"
                        />
                        {/* PR 8: the server read an iPhone's HEVC — the worker converts it after Post; the tile says so. */}
                        {uploads.itemFor(file.id)?.codec === 'hevc' && (file.durationSeconds ?? 0) <= MAX_VIDEO_SECONDS && (
                          <div role="status" data-media-will-process="" className="absolute inset-x-0 bottom-0 bg-black/60 text-white text-[11px] font-semibold px-2 py-1">
                            Will process after posting
                          </div>
                        )}
                        {(file.durationSeconds ?? 0) > MAX_VIDEO_SECONDS && (
                          <div role="status" className="absolute inset-x-0 bottom-0 bg-amber-500/90 text-black text-[11px] font-semibold px-2 py-1">
                            Too long — trim in the editor
                          </div>
                        )}
                      </>
                    )}

                    {/* A photo's upload state (a video's is VideoFrame's own):
                        the bar + the number while its bytes leave the device,
                        a Retry that keeps the file when they did not. */}
                    {file.type === 'image' && uploads.itemFor(file.id)?.status === 'pending' && (
                      <div
                        role="progressbar"
                        aria-label="Upload progress"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round((uploads.itemFor(file.id)?.progress ?? 0) * 100)}
                        className="absolute inset-x-0 bottom-0 bg-black/60 text-white text-[11px] font-semibold px-2 py-1"
                      >
                        <div className="h-1 bg-white/30 rounded-full overflow-hidden mb-1">
                          <div className="h-full bg-white rounded-full transition-[width]" style={{ width: `${Math.round((uploads.itemFor(file.id)?.progress ?? 0) * 100)}%` }} />
                        </div>
                        {Math.round((uploads.itemFor(file.id)?.progress ?? 0) * 100)}%
                      </div>
                    )}
                    {file.type === 'image' && uploads.itemFor(file.id)?.status === 'failed' && (
                      <button
                        type="button"
                        onClick={() => queue.retry(file.id)}
                        className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-red-900/60 px-2 text-center text-xs font-semibold text-white"
                        aria-label="Retry upload"
                        data-media-retry=""
                      >
                        <i className="fas fa-rotate-right" aria-hidden="true"></i>
                        <span>Upload failed — tap to retry</span>
                      </button>
                    )}

                    {/* Remove button. Padding grows the 24px circle to a 40px
                        hit area; the visual circle lives on the inner span. */}
                    <button
                      onClick={() => removeMediaFile(file.id)}
                      aria-label="Remove media"
                      className="absolute top-0 right-0 p-2 group"
                    >
                      <span className="bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center group-hover:bg-red-600 transition-colors">
                        <i className="fas fa-times text-xs"></i>
                      </span>
                    </button>

                    {/* Edit (re-opens the editor rehydrated with this asset's
                        recipe) — images AND videos: openEditorFor is
                        kind-agnostic and VideoStage rehydrates trim/poster. */}
                    {(file.sourceFile || file.file) && (
                      <button
                        onClick={() => openEditorFor(file)}
                        aria-label="Edit media"
                        className="absolute bottom-0 right-0 p-2 group"
                      >
                        <span className="bg-black/60 text-white rounded-full w-6 h-6 flex items-center justify-center group-hover:bg-black/80 transition-colors">
                          <i className="fas fa-pen text-xs"></i>
                        </span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

          </div>

          {/* Caption */}
          <div className={isLiveSetup ? 'hidden' : 'mb-6'}>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-semibold text-secondary">
                Caption
              </label>
              <span className={`text-xs ${
                caption.length > MAX_CAPTION_LENGTH * 0.9 ? 'text-red-600 dark:text-red-400' : 'text-muted'
              }`}>
                {caption.length}/{MAX_CAPTION_LENGTH}
              </span>
            </div>
            <textarea
              ref={captionRef}
              value={caption}
              onChange={(e) => setCaption(e.target.value.slice(0, MAX_CAPTION_LENGTH))}
              placeholder="Share your thoughts..."
              className="w-full px-4 py-3 border border-border-strong rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500 resize-none"
              rows={4}
            />
          </div>

          {/* Sport/Post Type Selection */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-secondary mb-3">Post Type</label>
            <button
              onClick={() => setShowSportSelector(true)}
              className="w-full p-4 border-2 border-border-strong rounded-lg text-left hover:border-violet-500 hover:bg-brand-soft transition-all group"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-lg bg-surface-sunken group-hover:bg-violet-100 dark:group-hover:bg-violet-950/60 flex items-center justify-center transition-colors">
                    <i className={`${
                      postType === 'general'
                        ? 'fas fa-edit'
                        : getSportDefinition(postType as SportKey).icon_id
                    } text-xl ${
                      postType === 'general' ? 'text-muted' : 'text-brand-fg'
                    } group-hover:text-brand-fg`}></i>
                  </div>
                  <div>
                    <div className="font-semibold text-primary">
                      {postType === 'general'
                        ? 'General Post'
                        : getSportDefinition(postType as SportKey).display_name
                      }
                    </div>
                    <div className="text-sm text-muted">
                      {postType === 'general'
                        ? 'Text, photos, and hashtags'
                        : getSportDefinition(postType as SportKey).primary_action
                      }
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-brand-fg">
                  <span className="text-sm font-medium">Change</span>
                  <i className="fas fa-chevron-right"></i>
                </div>
              </div>
            </button>
            {/* The way back to a General post (Oct 27 2026): the picker no
                longer offers "General Post", so a chosen sport is cleared
                HERE — a sibling of the row, never inside it. */}
            {postType !== 'general' && (
              <button
                type="button"
                data-post-type-clear=""
                onClick={() => {
                  setPostType('general');
                  setStatLineData(null);
                }}
                className="ea-interactive mt-2 text-sm text-muted hover:text-primary"
              >
                <i className="fas fa-times mr-1" aria-hidden="true"></i>
                Remove sport
              </button>
            )}
          </div>

          {/* Stat-line sport form (ice hockey, volleyball, …) */}
          {isStatLineSport && (
            <div className="mb-6">
              <StatLineForm
                sportKey={postType as SportKey}
                value={statLineData ?? emptyStatLine(postType as SportKey)}
                onChange={setStatLineData}
              />
            </div>
          )}

          {/* Sport-specific composer section — golf's round timing, round
              type, shared-round details, score entry and scorecard all live in
              GolfComposerSection (sport-cleanup D-2). Sections stay mounted
              for the life of the open modal regardless of the selected sport,
              so switching away and back preserves what was entered — the same
              behavior the old inline state had; each renders nothing while its
              sport is not selected. The key remounts them on reset(). */}
          {SPORT_COMPOSER_ENTRIES.map(([sportKey, SportSection]) => (
            <SportSection
              key={`${sportKey}-${sportSectionResetKey}`}
              userId={userId}
              active={postType === sportKey}
              onChange={setGolfValue}
              onCaptionGenerated={setCaption}
              seed={sportKey === 'golf' ? golfSeed : undefined}
            />
          ))}

          {/* Tags */}
          <div className={isLiveSetup ? 'hidden' : 'mb-6'}>
            <label className="block text-sm font-semibold text-secondary mb-3">Tags</label>
            <div className="flex flex-wrap gap-2">
              {currentTags.map(tag => (
                <button
                  key={tag.value}
                  onClick={() => toggleTag(tag.value)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                    selectedTags.includes(tag.value)
                      ? `bg-${tag.color}-100 text-${tag.color}-800 border-2 border-${tag.color}-300`
                      : 'bg-surface-sunken text-tertiary border-2 border-border hover:bg-gray-200 dark:hover:bg-stone-800'
                  }`}
                >
                  {selectedTags.includes(tag.value) && (
                    <i className="fas fa-check mr-1 text-xs"></i>
                  )}
                  {tag.label}
                </button>
              ))}
            </div>
          </div>

          {/* Hashtags */}
          <div className={isLiveSetup ? 'hidden' : 'mb-6'}>
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm font-semibold text-secondary">
                Hashtags ({hashtags.length}/{MAX_HASHTAGS})
              </label>
              <button
                onClick={() => setShowHashtagSuggestions(!showHashtagSuggestions)}
                className="relative after:absolute after:content-[''] after:-inset-y-3 after:-inset-x-1 text-sm text-brand-fg hover:text-brand-fg-strong"
              >
                {showHashtagSuggestions ? 'Hide' : 'Show'} suggestions
              </button>
            </div>

            {/* Selected hashtags */}
            {hashtags.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {hashtags.map(hashtag => (
                  <span
                    key={hashtag}
                    className="inline-flex items-center gap-1 px-3 py-1 bg-violet-100 dark:bg-violet-950/60 text-violet-800 dark:text-violet-200 rounded-full text-sm"
                  >
                    {hashtag}
                    <button
                      onClick={() => removeHashtag(hashtag)}
                      aria-label={`Remove ${hashtag}`}
                      className="ml-0.5 -my-2 -mr-2 p-2 hover:text-violet-900 dark:hover:text-violet-200 inline-flex items-center justify-center"
                    >
                      <i className="fas fa-times text-xs"></i>
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Custom hashtag input.
                The input carries min-w-0 because a flex item defaults to
                min-width:auto and will not shrink below the input's intrinsic
                width — without it the adjacent Add button was pushed past the
                modal edge at 320px. */}
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                value={customHashtag}
                onChange={(e) => setCustomHashtag(e.target.value)}
                onKeyDown={handleCustomHashtagSubmit}
                placeholder="Type a hashtag and press Enter"
                className="flex-1 min-w-0 px-3 py-2 border border-border-strong rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
                disabled={hashtags.length >= MAX_HASHTAGS}
              />
              <button
                onClick={() => {
                  if (customHashtag.trim()) {
                    addHashtag(customHashtag.trim());
                    setCustomHashtag('');
                  }
                }}
                disabled={!customHashtag.trim() || hashtags.length >= MAX_HASHTAGS}
                className="px-4 py-2 bg-brand text-white rounded-lg hover:bg-brand-hover disabled:bg-gray-300 dark:disabled:bg-stone-700 disabled:cursor-not-allowed transition-colors"
              >
                Add
              </button>
            </div>

            {/* Hashtag suggestions */}
            {showHashtagSuggestions && (
              <div className="flex flex-wrap gap-1">
                {currentHashtags
                  .filter(tag => !hashtags.includes(tag))
                  .map(hashtag => (
                    <button
                      key={hashtag}
                      onClick={() => addHashtag(hashtag)}
                      disabled={hashtags.length >= MAX_HASHTAGS}
                      className="relative after:absolute after:content-[''] after:-inset-y-2.5 after:inset-x-0 px-2 py-1 text-xs bg-surface-sunken text-secondary rounded-full hover:bg-violet-100 dark:hover:bg-violet-950/60 hover:text-brand-fg-strong disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {hashtag}
                    </button>
                  ))
                }
              </div>
            )}
          </div>

          {/* Tag People */}
          <div className={isLiveSetup ? 'hidden' : 'mb-6'}>
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm font-semibold text-secondary">Tag People</label>
              <button
                onClick={() => setShowTagModal(true)}
                className="flex items-center gap-2 px-3 py-1.5 text-sm text-brand-fg hover:text-brand-fg-strong hover:bg-brand-soft rounded-lg transition-colors"
              >
                <i className="fas fa-user-tag"></i>
                {taggedProfiles.length > 0 ? `Tagged (${taggedProfiles.length})` : 'Add Tags'}
              </button>
            </div>

            {/* Tagged people chips */}
            {taggedProfilesData.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {taggedProfilesData.map(profile => (
                  <span
                    key={profile.id}
                    className="inline-flex items-center gap-2 px-3 py-1.5 bg-violet-100 dark:bg-violet-950/60 text-violet-800 dark:text-violet-200 rounded-full text-sm font-medium border border-violet-300 dark:border-violet-700"
                  >
                    <i className="fas fa-user text-xs"></i>
                    {profile.name}
                    <button
                      onClick={() => removeTaggedPerson(profile.id)}
                      aria-label={`Remove ${profile.name}`}
                      className="ml-1 hover:text-violet-900 dark:hover:text-violet-200"
                    >
                      <i className="fas fa-times text-xs"></i>
                    </button>
                  </span>
                ))}
              </div>
            )}

            {taggedProfilesData.length === 0 && (
              <p className="text-sm text-muted">
                <i className="fas fa-info-circle mr-1"></i>
                Tag people who are in your photos or videos
              </p>
            )}
          </div>

          {/* Who sees it: the ACCOUNT's call (Oct 9 2026, Tom) — never a
              per-post audience. The one switch is the feed (269): off, the
              post still stands on the profile. A guardian posting as an
              athlete sees the athlete's account. */}
          <div className="mb-6" data-composer-audience="">
            <FeedToggle on={onFeed} onChange={setOnFeed} kind={feedKind} place={defaultPostCategory === 'training' ? 'in Training' : undefined} accountVisibility={(activeProfile ?? profile)?.visibility ?? null} />
          </div>
        </div>

        {/* Footer.
            Stacks below `sm`: as a single non-wrapping row, the hint + Cancel +
            Preview + Create Post overflowed the modal on every phone width and
            clipped the primary submit button off the right edge (375px: the
            "Create Post" button ran to 424px in a 375px viewport). */}
        <div className="flex flex-col gap-3 p-4 border-t border-border bg-surface-muted sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="text-sm text-tertiary">
            {/* What the disabled Post needs, as a calm hint — not a red
                error before anything was tried (Oct 9 2026 appearance round). */}
            {!isValidForSubmission() && (
              <span className="text-secondary" data-composer-hint="">
                <i className="fas fa-circle-info mr-1.5 text-brand-fg" aria-hidden="true"></i>
                {postType === 'golf'
                  ? (() => {
                      // Name the ACTUAL missing fields — a dead grey button
                      // with a stale generic hint reads as "broken"
                      const { sharedRoundDetails } = golfValue;
                      const missing: string[] = [];
                      if (!sharedRoundDetails.courseName.trim()) missing.push('course name');
                      if (!sharedRoundDetails.date) missing.push('date');
                      return missing.length > 0
                        ? `Missing: ${missing.join(', ')}`
                        : 'Please complete the round details';
                    })()
                  : 'Add a caption or media to post'
                }
              </span>
            )}
          </div>

          {/* Wraps on phones; each button claims an equal share of the row so
              three actions still fit at 320px without clipping. */}
          <div className="flex flex-wrap gap-3 w-full sm:w-auto sm:flex-nowrap">
            <button
              onClick={requestClose}
              className="flex-1 min-w-[7.5rem] sm:flex-none whitespace-nowrap px-4 sm:px-6 py-2 text-secondary bg-surface border border-border-strong rounded-lg hover:bg-surface-muted transition-colors"
            >
              Cancel
            </button>

            <button
              onClick={() => setShowPreview(true)}
              disabled={!isValidForSubmission()}
              className="flex-1 min-w-[7.5rem] sm:flex-none whitespace-nowrap px-4 sm:px-6 py-2 text-secondary bg-surface-sunken border border-border-strong rounded-lg hover:bg-gray-200 dark:hover:bg-stone-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <i className="fas fa-eye mr-2"></i>
              Preview
            </button>

            <button
              onClick={() => {
                handleSubmit();
              }}
              disabled={!isValidForSubmission() || isSubmitting}
              className={`flex-1 min-w-[7.5rem] sm:flex-none whitespace-nowrap px-4 sm:px-6 py-2 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${
                isLiveSetup ? 'bg-red-600 hover:bg-red-700' : 'bg-brand hover:bg-brand-hover'
              }`}
            >
              {isSubmitting ? (
                <>
                  <i className="fas fa-spinner fa-spin mr-2"></i>
                  {uploadingLine(mediaFiles.map(f => uploads.itemFor(f.id)?.progress)) ?? (isLiveSetup ? 'Starting…' : 'Creating...')}
                </>
              ) : isLiveSetup ? (
                <>
                  <span className="inline-block w-2 h-2 bg-surface rounded-full mr-2 animate-pulse align-middle"></span>
                  Go Live
                </>
              ) : (
                <>
                  <i className="fas fa-paper-plane mr-2"></i>
                  Create Post
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Preview Modal */}
      {showPreview && (
        <PostPreview
          holeParSource={golfValue.holeParSource}
          postType={postType}
          caption={caption}
          tags={selectedTags}
          hashtags={hashtags}
          mediaFiles={mediaFiles}
          accountVisibility={(activeProfile ?? profile)?.visibility ?? null}
          taggedPeople={taggedProfilesData}
          sharedRoundDetails={golfValue.sharedRoundDetails}
          sharedRoundParticipants={golfValue.sharedRoundParticipantsData}
          playerScores={golfValue.playerScores}
          userId={userId}
          onClose={() => setShowPreview(false)}
          onPost={() => {
            setShowPreview(false);
            handleSubmit();
          }}
        />
      )}

      {/* Tag People Modal */}
      <TagPeopleModal
        isOpen={showTagModal}
        onClose={() => setShowTagModal(false)}
        existingTags={taggedProfiles}
        onSelectionComplete={handleTagPeopleComplete}
        selectionMode={true}
      />

      {/* The participant-selection TagPeopleModal for shared rounds moved
          into GolfComposerSection, which owns the participant state. */}

      {/* Sport Selector Modal */}
      {showSportSelector && (
        <SportSelector
          onSelectSport={(sport) => {
            setPostType(sport);
            setStatLineData(null); // stat entries are per-sport
          }}
          onClose={() => setShowSportSelector(false)}
        />
      )}

      {/* Shared media editor (z-[65], above this modal and its sub-modals) */}
      {editorAssets && (
        <MediaEditor
          assets={editorAssets}
          config={COMPOSER_EDITOR_CONFIG}
          onDone={handleEditorDone}
          onCancel={() => {
            setEditorAssets(null);
            setEditingExistingId(null);
          }}
        />
      )}
    </div>
  );
}

// Helper function to transform form data into CompleteGolfScorecard format for preview
function transformToScorecardPreview(
  sharedRoundDetails: SharedRoundDetails,
  sharedRoundParticipants: {id: string; name: string; avatar_url?: string}[],
  playerScores: PlayerScore[],
  userId: string,
  holeParSource: { hole: number; par: number }[] | null = null
): CompleteGolfScorecard {
  // Create mock group_post
  const mockGroupPost = {
    id: 'preview-' + Date.now(),
    creator_id: userId,
    type: 'golf_round' as const,
    title: `Round at ${sharedRoundDetails.courseName}`,
    description: null,
    date: sharedRoundDetails.date,
    location: sharedRoundDetails.courseName,
    visibility: 'public' as const,
    status: 'pending' as const,
    post_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  // Create golf_data
  const golfData = {
    id: 'preview-golf-' + Date.now(),
    group_post_id: mockGroupPost.id,
    course_name: sharedRoundDetails.courseName,
    course_id: null,
    round_type: sharedRoundDetails.roundTypeIndoorOutdoor,
    holes_played: sharedRoundDetails.holesPlayed,
    tee_color: sharedRoundDetails.teeColor || null,
    slope_rating: null,
    course_rating: null,
    weather_conditions: sharedRoundDetails.weather || null,
    temperature: sharedRoundDetails.temperature ? parseInt(sharedRoundDetails.temperature) : null,
    wind_speed: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  // Transform participants with scores
  const participants = sharedRoundParticipants.map(participant => {
    // Find matching player scores
    const playerScore = playerScores.find(ps => ps.participant_id === participant.id);

    // Calculate total score and holes completed from hole scores
    let totalScore: number | null = null;
    let holesCompleted = 0;
    let toPar: number | null = null;

    if (playerScore && playerScore.hole_scores) {
      // Shared domain math — uses REAL course hole pars when available
      // (the old inline version assumed par 4 for every hole)
      const totals = calcPlayerTotals(playerScore.hole_scores, holeParSource);
      if (totals.played > 0) {
        totalScore = totals.total;
        holesCompleted = totals.played;
        toPar = totals.toPar;
      }
    }

    const isCreator = participant.id === userId;

    return {
      participant: {
        id: 'preview-participant-' + participant.id,
        group_post_id: mockGroupPost.id,
        profile_id: participant.id,
        status: 'confirmed' as const,
        role: (isCreator ? 'creator' : 'participant') as ParticipantRole,
        attested_at: new Date().toISOString(),
        data_contributed: totalScore !== null,
        last_contribution: totalScore !== null ? new Date().toISOString() : null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        profile: {
          id: participant.id,
          full_name: participant.name,
          first_name: participant.name.split(' ')[0] || null,
          middle_name: null,
          last_name: participant.name.split(' ').slice(1).join(' ') || null,
          avatar_url: participant.avatar_url || null,
          sport: null,
          school: null
        }
      },
      scores: {
        id: 'preview-scores-' + participant.id,
        participant_id: 'preview-participant-' + participant.id,
        entered_by: userId,
        scores_confirmed: false,
        total_score: totalScore,
        to_par: toPar,
        holes_completed: holesCompleted,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        hole_scores: playerScore?.hole_scores?.map((h, idx) => ({
          id: 'preview-hole-' + participant.id + '-' + idx,
          golf_participant_id: 'preview-scores-' + participant.id,
          hole_number: h.hole_number,
          strokes: h.strokes || 0,
          putts: h.putts || null,
          fairway_hit: h.fairway_hit || null,
          green_in_regulation: h.green_in_regulation || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })) || []
      }
    };
  });

  return {
    group_post: mockGroupPost,
    golf_data: golfData,
    participants
  };
}

// Post Preview Component
function PostPreview({
  postType,
  caption,
  tags,
  hashtags,
  mediaFiles,
  accountVisibility,
  taggedPeople = [],
  sharedRoundDetails,
  sharedRoundParticipants = [],
  playerScores = [],
  userId = '',
  holeParSource = null,
  onClose,
  onPost
}: PostPreviewProps) {
  const tagOptions = getTagOptions(postType);

  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-[60] p-4">
      <div className="bg-surface-raised rounded-lg shadow-2xl max-w-2xl w-full max-h-modal overflow-y-auto">
        {/* Preview Header */}
        <div className="flex items-center justify-between p-4 border-b border-border bg-surface-muted">
          <h3 className="text-lg font-semibold text-primary">Post Preview</h3>
          <button
            onClick={onClose}
            aria-label="Close preview"
            className="p-2 hover:bg-gray-200 dark:hover:bg-stone-800 rounded-lg transition-colors"
          >
            <i className="fas fa-times text-tertiary"></i>
          </button>
        </div>

        {/* Mock Post */}
        <div className="p-6">
          <div className="bg-surface border border-border rounded-lg">
            {/* Post Header */}
            <div className="p-4 border-b border-border-subtle">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-violet-500 to-purple-600 rounded-full"></div>
                <div>
                  <div className="font-semibold text-primary">Your Name</div>
                  <div className="text-sm text-muted">
                    Just now • {isPrivateAccount(accountVisibility) ? 'Your fans' : 'Anyone'}
                  </div>
                </div>
              </div>
            </div>

            {/* Post Content */}
            <div className="p-4">
              {/* Media — first, mirroring the composer's media-first order */}
              {mediaFiles.length > 0 && (
                <div className={`grid ${mediaFiles.length === 1 ? 'grid-cols-1' : 'grid-cols-2'} gap-2 rounded-lg overflow-hidden mb-3`}>
                  {mediaFiles.slice(0, 4).map((file: MediaFile, index: number) => (
                    <div key={file.id} className="relative aspect-square bg-surface-sunken p-1.5">
                      {/* Same fix as the upload grid above: fill the cell,
                          don't bake pixel dimensions into an inline style. */}
                      {file.type === 'image' ? (
                        <MediaTile
                          src={file.url}
                          kind="image"
                          alt=""
                          className="h-full w-full"
                          sizes="(max-width: 640px) 45vw, (max-width: 768px) 30vw, 300px"
                        />
                      ) : (
                        <VideoFrame src={file.url} poster={file.posterPreviewUrl} alt="" className="w-full h-full" />
                      )}
                      {index === 3 && mediaFiles.length > 4 && (
                        <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                          <span className="text-white text-2xl font-bold">+{mediaFiles.length - 4}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Caption */}
              {caption && (
                <p className="text-primary whitespace-pre-wrap mb-3">{caption}</p>
              )}

              {/* Hashtags */}
              {hashtags.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-3">
                  {hashtags.map((tag: string) => (
                    <span key={tag} className="text-brand-fg hover:underline cursor-pointer">
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {/* Tagged People */}
              {taggedPeople.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3 items-center">
                  <span className="text-sm text-tertiary">with</span>
                  {taggedPeople.map((person: {id: string; name: string}) => (
                    <span
                      key={person.id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-brand-soft text-brand-fg-strong text-sm rounded-full font-semibold border border-violet-200 dark:border-violet-800"
                    >
                      <i className="fas fa-user text-xs"></i>
                      {person.name}
                    </span>
                  ))}
                </div>
              )}

              {/* Tags */}
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-4">
                  {tags.map((tagValue: string) => {
                    const tag = tagOptions.find((t: TagOption) => t.value === tagValue);
                    if (!tag) return null;
                    return (
                      <span
                        key={tagValue}
                        className={`px-2 py-1 bg-${tag.color}-100 text-${tag.color}-800 text-xs rounded-full font-medium`}
                      >
                        {tag.label}
                      </span>
                    );
                  })}
                </div>
              )}

              {/* Golf Scorecard Summary — one flow: every round previews as
                  the shared scorecard (the individual golfData branch retired
                  with the flow unification). */}
              {postType === 'golf' && sharedRoundDetails && (
                <div className="mb-4 p-4 bg-green-50 dark:bg-green-950/40 rounded-lg border border-green-200 dark:border-green-800">
                  <div className="flex items-center gap-2 mb-2">
                    <i className="fas fa-golf-ball text-green-600 dark:text-green-400"></i>
                    <span className="font-semibold text-green-800 dark:text-green-200">
                      Golf Round
                    </span>
                  </div>
                  <div className="text-sm text-green-700 dark:text-green-300 space-y-1">
                    <div className="relative">
                      <SharedRoundQuickView
                        scorecard={transformToScorecardPreview(
                          sharedRoundDetails,
                          sharedRoundParticipants,
                          playerScores,
                          userId,
                          holeParSource
                        )}
                        currentUserId={userId}
                      />
                    </div>
                  </div>
                </div>
              )}

            </div>

            {/* Mock Engagement */}
            <div className="px-4 py-3 border-t border-border-subtle flex justify-between text-muted">
              <div className="flex gap-4">
                <button className="hover:text-brand-fg transition-colors">
                  <i className="far fa-heart mr-1"></i> Like
                </button>
                <button className="hover:text-brand-fg transition-colors">
                  <i className="far fa-comment mr-1"></i> Comment
                </button>
                <button className="hover:text-brand-fg transition-colors">
                  <i className="fas fa-share mr-1"></i> Share
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Preview Actions */}
        <div className="px-6 py-4 border-t border-border bg-surface-muted flex justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 text-tertiary hover:text-primary transition-colors"
          >
            Edit Post
          </button>
          <button
            onClick={onPost}
            className="px-6 py-2 bg-brand text-white rounded-lg hover:bg-brand-hover transition-colors"
          >
            <i className="fas fa-paper-plane mr-2"></i>
            Post Now
          </button>
        </div>
      </div>
    </div>
  );
}