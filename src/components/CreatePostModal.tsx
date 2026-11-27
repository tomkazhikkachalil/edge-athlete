'use client';

import { useState, useCallback, useRef, useEffect, useMemo, type ComponentType } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { afterCreatePath } from '@/lib/golf/round-route';
import { refreshDrafts } from '@/hooks/useDrafts';
import { useToast } from '@/components/Toast';
import { getHashtagSuggestions } from '@/lib/sports/post-tags';
import { MAX_DEVICE_POSTER_ATTEMPTS, planPosterRetry, POSTER_GRAB_DEADLINE_MS, POSTER_RETRY_DEADLINE_MS, posterTimeFor, type PosterFailure } from '@/lib/media/poster-plan';
import { useMediaUploadQueue } from '@/components/media/useMediaUploadQueue';
import { grabBlurInto } from '@/components/media/grab-poster';
import { UploadError } from '@/lib/media/upload';
import type { QueueItem } from '@/lib/media/upload-queue';
import TagPeopleModal from '@/components/TagPeopleModal';
import SportSelector from '@/components/SportSelector';
import { defaultGolfComposerValue, type GolfComposerValue } from '@/components/golf/GolfComposerSection';
import { submitSharedRound } from '@/components/golf/shared-round-submit';
import { SPORT_COMPOSER_EXTRAS, type SportComposerExtraProps } from '@/components/sport-composer-extras';
import { getSportDefinition, type SportKey } from '@/lib/sports/SportRegistry';
import StatLineForm, { emptyStatLine, statLineHasContent } from '@/components/StatLineForm';
import { getStatSchema, type StatLineData } from '@/lib/sports/stat-schemas';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useDirtyClose } from '@/hooks/useDirtyClose';
import ConfirmModal from '@/components/ConfirmModal';
import ChoiceDialog from '@/components/mech/ChoiceDialog';
import SlideToConfirm from '@/components/mech/SlideToConfirm';
import { COPY } from '@/lib/copy';
import { MediaEditor, warmEditorChunk } from '@/components/media-editor';
import { validateFiles } from '@/lib/media/validation';
import { recipeEnvelope } from '@/lib/media/recipes';
import { loadComposerDraft, saveComposerDraft, clearComposerDraft, isEmptyComposerDraft, orderByDraft, type ComposerDraft } from '@/lib/posts/composer-draft';
import { attachOriginalInBackground } from '@/lib/media/upload';
import { prepareImageForUpload } from '@/lib/media/post-time-resize';
import { planPickAttach, usableDuration } from '@/lib/media/capture-attach';
import { uploadingLine } from '@/lib/media/upload-progress';
import { MAX_VIDEO_SECONDS } from '@/lib/media/limits';
import type { EditRecipe, EditedMedia, EditorConfig, MediaAsset } from '@/lib/media/types';
import { MAX_UPLOAD_BYTES } from '@/lib/media/upload-rules';
import FeedToggle from '@/components/posts/FeedToggle';
import { readFeedDefault } from '@/lib/posts/feed-memory';
import { POST_VISIBILITY } from '@/lib/posts/audience';
import { canPost, isEmptyPost, slideWords, withHashtag } from '@/lib/posts/composer-rules';
import { moveToCover } from '@/lib/media/cover';
import MediaSection, { type ComposerMediaItem, type ComposerUpload, type MediaEditTool } from '@/components/composer/MediaSection';
import CaptionPanel from '@/components/composer/CaptionPanel';
import { AttachRow, DetailsPanel, LocationRow, TagPeopleRow, type TaggedPerson } from '@/components/composer/DetailsPanel';
import AttachPicker from '@/components/composer/AttachPicker';
import LocationDialog from '@/components/composer/LocationDialog';
import { plateColour } from '@/components/posts/StatPlate';
import { attachRowLabel, type StatPlateData } from '@/lib/posts/attachment';
import type { PostLocation } from '@/lib/posts/location';
import { EyeIcon } from '@/components/composer/icons';
import { PencilIcon } from '@/components/golf/scoring/icons';
import type { PostCardPost } from '@/components/PostCard';
import FaIcon from '@/components/FaIcon';
import { faClockRotateLeft } from '@/lib/icons/fa/clock-rotate-left';
import { faXmark } from '@/lib/icons/fa/xmark';
import { sportIcon } from '@/lib/sports/sport-icons';

// The preview draws the real feed card: loaded on the first tap of the eye
// key, never with the composer.
const PreviewOverlay = dynamic(() => import('@/components/composer/PreviewOverlay'), { ssr: false });

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

// Hashtag suggestions are registry-driven — see src/lib/sports/post-tags.ts
// (per-sport lists live on SportDefinition).

// Sport composer slot entries, resolved once at module scope so the section
// components are identity-stable across renders (a new array per render would
// still reuse elements by key, but there is no reason to rebuild it).
// The golf round's dialog width from 640 px up, by the frame its step names
// (round-steps.ts roundFrame). Whole class names: Tailwind reads them here.
const GOLF_FRAME_WIDTH = {
  narrow: 'sm:max-w-[480px]',
  wide: 'sm:max-w-[760px]',
  full: 'sm:max-w-[920px]',
} as const;

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
  // Native-camera capture lives in the shared <CaptureInputs> (capture-
  // everywhere round); it feeds the same validate→editor pipeline.

  // Post type and content
  const [postType, setPostType] = useState<SportKey | 'general'>(defaultSportKey);
  const [showSportSelector, setShowSportSelector] = useState(false);

  // The modal stays mounted with isOpen toggling, so the useState initializer
  // above only ever sees the FIRST defaultSportKey. Re-apply it on each open
  // transition (ref-guarded so a prop change mid-composition can't clobber
  // what the user picked).
  // Post to feed (269): a switch, not an audience; remembered per kind on this
  // device. A GENERAL post has no switch (Tom, Nov 26 2026): it always goes to
  // the feed and the profile. A sport's stat-line post keeps the switch.
  const feedKind = defaultPostCategory === 'training' ? 'workout' : 'sport';
  const [feedSwitch, setFeedSwitch] = useState(() => readFeedDefault(feedKind));
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
      setFeedSwitch(readFeedDefault(defaultPostCategory === 'training' ? 'workout' : 'sport'));
    }
    wasOpenRef.current = isOpen;
  }, [isOpen, defaultSportKey, openSportPicker, defaultPostCategory]);

  // Stat-line sports (ice hockey, volleyball, …) — schema-driven stat entry
  const [statLineData, setStatLineData] = useState<StatLineData | null>(null);
  const isStatLineSport = postType !== 'general' && getStatSchema(postType) !== null;
  const [caption, setCaption] = useState('');
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [customHashtag, setCustomHashtag] = useState('');

  // Media management. The selected thumbnail shows its edit keys (A7).
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([]);
  const [selectedMediaId, setSelectedMediaId] = useState<string | null>(null);

  // Tagging people (the row's faces need the picture, the draft keeps them).
  const [taggedProfilesData, setTaggedProfilesData] = useState<TaggedPerson[]>([]);
  const taggedProfiles = useMemo(() => taggedProfilesData.map(p => p.id), [taggedProfilesData]);
  const [showTagModal, setShowTagModal] = useState(false);

  // One attached activity and one location (321). The plate is what the
  // picker handed over; the server checks the reference again at Post.
  const [attached, setAttached] = useState<StatPlateData | null>(null);
  const [showAttachPicker, setShowAttachPicker] = useState(false);
  const closeAttachPicker = useCallback(() => setShowAttachPicker(false), []);
  const [location, setLocation] = useState<PostLocation | null>(null);
  const [showLocation, setShowLocation] = useState(false);

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
  // The golf round's dialog width on a desktop, named by the section's step
  // (round-steps.ts roundFrame): 480 px, then 760 px once a course is named.
  const [golfFrame, setGolfFrame] = useState<'narrow' | 'wide' | 'full'>('narrow');

  // Visibility and submission
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [isSubmitting, setIsSubmitting] = useState(false);
  // The post is up: the slide shows "Posted" for a moment, then the composer closes.
  const [posted, setPosted] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  // A draft the person SAVED and then restored stays a saved draft while they work on it.
  const [draftKept, setDraftKept] = useState(false);

  // Shared media editor session (null = closed). editingExistingId set when
  // re-editing an already-attached asset (result replaces it in place).
  const [editorAssets, setEditorAssets] = useState<MediaAsset[] | null>(null);
  const [editingExistingId, setEditingExistingId] = useState<string | null>(null);
  // The tool the editor opens on (the selected thumbnail's Crop / Adjust / Filter key).
  const [editorTool, setEditorTool] = useState<MediaEditTool | undefined>(undefined);

  // Persist the recoverable half of the composer while open (storage write
  // only — media Files and the uncontrolled golf section can't ride
  // localStorage; see composer-draft.ts). An OFFERED draft waits for its
  // decision: a saved one is never overwritten, and an empty composer never
  // erases the one on offer.
  const mediaIdsKey = mediaFiles.map(f => f.id).join('|');
  const draftSnapshot = useMemo<ComposerDraft>(() => {
    const mediaOrder = mediaIdsKey === '' ? [] : mediaIdsKey.split('|');
    return {
      postType,
      caption,
      hashtags,
      visibility,
      // The golf section rides along only while it holds real work (G1).
      ...(golfValue.isDirty ? { golf: golfValue } : {}),
      ...(mediaOrder.length > 0 ? { mediaCount: mediaOrder.length, mediaOrder } : {}),
      ...(taggedProfilesData.length > 0 ? { people: taggedProfilesData } : {}),
      ...(attached ? { attached } : {}),
      ...(location ? { location } : {}),
      ...(draftKept ? { kept: true } : {}),
    };
  }, [postType, caption, hashtags, visibility, golfValue, mediaIdsKey, taggedProfilesData, attached, location, draftKept]);
  const keptPending = availableDraft?.kept === true;
  const draftOffered = availableDraft !== null;
  useEffect(() => {
    if (!isOpen || keptPending) return;
    if (draftOffered && isEmptyComposerDraft(draftSnapshot)) return;
    const timer = setTimeout(() => saveComposerDraft(draftSnapshot), 400);
    return () => clearTimeout(timer);
  }, [isOpen, keptPending, draftOffered, draftSnapshot]);

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
  // The composer's stashed bytes have no clock (a saved draft has no expiry):
  // an open that finds NO draft to offer them back with clears what is left.
  useEffect(() => {
    if (isOpen && loadComposerDraft() === null) queue.clearStash();
  }, [isOpen, queue]);
  const restoreStashedMedia = async (order?: string[]) => {
    const resumed = await queue.resumeFromStash();
    // A draft names its own attachments: bytes it does not name belong to
    // work that was posted or dropped since, and go.
    const wanted = order && order.length > 0 ? new Set(order) : null;
    for (const r of resumed.restored) if (wanted && !wanted.has(r.item.localId)) queue.forget(r.item.localId);
    const restored = orderByDraft(
      resumed.restored.filter(r => !wanted || wanted.has(r.item.localId)).map(r => ({ ...r, id: r.item.localId })),
      order
    );
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
    setHashtags([]);
    revokePreviews(mediaFiles);
    setMediaFiles([]);
    setSelectedMediaId(null);
    setStatLineData(null);
    setVisibility('public');
    setCustomHashtag('');
    setShowPreview(false);
    setPosted(false);
    setDraftKept(false);
    setTaggedProfilesData([]);
    setAttached(null);
    setShowAttachPicker(false);
    setLocation(null);
    setShowLocation(false);
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
    // is crash recovery, not resurrecting decisions. A SAVED draft still on
    // offer (never restored) is not this work: its text and its bytes stay.
    if (keptPending) {
      queue.forgetAll();
    } else {
      clearComposerDraft();
      clearComposerStash();
      queue.forgetAll();
      setAvailableDraft(null);
    }
    reset();
    onClose();
  };

  // Anything reset() would throw away counts as unsaved work — an
  // 18-hole scorecard is the most painful loss this modal can inflict.
  const isDirty = () =>
    caption.trim() !== '' ||
    mediaFiles.length > 0 ||
    hashtags.length > 0 ||
    customHashtag.trim() !== '' ||
    taggedProfiles.length > 0 ||
    attached !== null ||
    location !== null ||
    statLineData !== null ||
    // Golf's share (scorecard, course, participants, manual pars, scores) is
    // computed in GolfComposerSection.
    golfValue.isDirty;

  const { requestClose, confirmOpen, confirmDiscard, cancelDiscard } = useDirtyClose(isDirty, closeAndReset);

  // Save draft (A11; Tom, Nov 26 2026: on this device, no expiry): the same
  // record the crash recovery writes, marked kept, with the media's bytes left
  // in the device stash. The composer offers it back when it is next opened.
  const saveDraftAndClose = () => {
    cancelDiscard();
    saveComposerDraft({ ...draftSnapshot, hashtags: withHashtag(hashtags, customHashtag, MAX_HASHTAGS), kept: true });
    queue.releaseAll();
    setAvailableDraft(null);
    reset();
    onClose();
  };

  // Picked files go through the shared media editor before joining the post.
  // Validation now mirrors the server allowlist AT PICK (HEIC no longer fails
  // after a full upload — it re-encodes in the editor), and the size cap
  // matches the server's MAX_UPLOAD_BYTES (edited images re-encode far smaller anyway).
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
      setEditorTool(undefined);
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

  const openEditorFor = (mediaFile: MediaFile, tool?: MediaEditTool) => {
    const source = mediaFile.sourceFile ?? mediaFile.file;
    if (!source) return; // existing remote media (edit flows) has no File
    setEditorTool(tool);
    setEditingExistingId(mediaFile.id);
    setEditorAssets([{ id: mediaFile.id, file: source, kind: mediaFile.type, recipe: mediaFile.recipe }]);
  };

  // A thumbnail dragged over another (a mouse): it takes that place.
  const moveMedia = (from: number, to: number) => {
    setMediaFiles(prev => {
      if (from < 0 || from >= prev.length || to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
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
    setSelectedMediaId(prev => (prev === fileId ? null : prev));
  };

  // Hashtags: formatted, never twice, never past the limit (composer-rules.ts).
  const addHashtag = (hashtag: string) => setHashtags(prev => withHashtag(prev, hashtag, MAX_HASHTAGS));
  const removeHashtag = (hashtag: string) => setHashtags(prev => prev.filter(h => h !== hashtag));

  // The dialog hands back the people picked THIS time (the ones already
  // tagged are filtered out of its results): they join the row.
  const handleTagPeopleComplete = (_selectedIds: string[], selectedProfiles?: ProfileData[]) => {
    if (!selectedProfiles || selectedProfiles.length === 0) return;
    setTaggedProfilesData(prev => {
      const have = new Set(prev.map(p => p.id));
      const fresh = selectedProfiles
        .filter(p => !have.has(p.id))
        .map((p): TaggedPerson => ({
          id: p.id,
          name: p.first_name && p.last_name ? `${p.first_name} ${p.last_name}` : p.full_name || p.first_name || 'Unknown User',
          avatarUrl: p.avatar_url ?? null,
        }));
      return [...prev, ...fresh];
    });
  };

  const removeTaggedPerson = (profileId: string) => {
    setTaggedProfilesData(prev => prev.filter(p => p.id !== profileId));
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
    // A General post needs a caption, media, or an attached activity (A3)
    if (postType === 'general') {
      return caption.trim().length > 0 || mediaFiles.length > 0 || attached !== null;
    }

    // Stat-line sports: postable with a caption, media, or any entered stats
    if (isStatLineSport) {
      return (
        caption.trim().length > 0 ||
        mediaFiles.length > 0 ||
        attached !== null ||
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

      // A General post always goes to the feed and the profile (Tom, Nov 26
      // 2026); a sport's stat-line post follows its switch (269).
      const onFeed = postType === 'general' ? true : feedSwitch;
      // Prepare post data (userId comes from auth)
      const postData = {
        postType,
        caption: caption.trim(),
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
        // One attached activity (a reference the server checks) and one location (321).
        ...(attached ? { attached: { kind: attached.kind, id: attached.id } } : {}),
        ...(location ? { location } : {}),
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

      // The slide reads "Posted" for a moment, then the composer closes as it always did.
      setPosted(true);
      await new Promise(resolve => setTimeout(resolve, 600));
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

  // Escape asks to close (the one-page composer; a golf round's steps keep
  // their own keys). A dialog above the composer answers Escape itself.
  const dialogAbove = confirmOpen || showTagModal || showSportSelector || showPreview || showAttachPicker || showLocation || editorAssets !== null;
  useEffect(() => {
    if (!isOpen || postType === 'golf' || dialogAbove) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, postType, dialogAbove, requestClose]);

  if (!isOpen) return null;

  const currentHashtags = getHashtagSuggestions(postType);
  const isGolf = postType === 'golf';
  const isGeneral = postType === 'general';
  const account = activeProfile ?? profile;

  // The media block's view of the tiles and of the queue (the one truth for upload state).
  const mediaItems: ComposerMediaItem[] = mediaFiles.map(file => ({
    id: file.id,
    url: file.url,
    type: file.type,
    posterUrl: file.posterPreviewUrl,
    editable: Boolean(file.sourceFile || file.file),
    tooLong: file.type === 'video' && (file.durationSeconds ?? 0) > MAX_VIDEO_SECONDS,
    // PR 8: the server read an iPhone's HEVC — the worker converts it after Post.
    willProcess: file.type === 'video' && uploads.itemFor(file.id)?.codec === 'hevc',
  }));
  const uploadOf = (id: string): ComposerUpload => {
    const item = uploads.itemFor(id);
    if (!item) return { status: mediaFiles.find(f => f.id === id)?.file ? 'pending' : 'stored', progress: 0 };
    return { status: item.status, progress: item.progress };
  };
  const uploading = mediaFiles.some(f => uploadOf(f.id).status === 'pending');
  const readiness = {
    mediaCount: mediaFiles.length,
    caption,
    hasActivity: attached !== null,
    hasStats: isStatLineSport && statLineData !== null && statLineHasContent(statLineData),
    uploading,
    tooLongVideo: hasTooLongVideo,
  };
  const readyToPost = canPost(readiness);
  const nothingEntered = isEmptyPost(readiness);

  // The app's real limits, behind the Media label's info key (A12, R3).
  const mediaInfo = [
    `Up to ${MAX_MEDIA_FILES} photos or videos in a post, ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB each.`,
    `A video can be ${Math.round(MAX_VIDEO_SECONDS / 60)} minutes long. A longer one can be trimmed in the editor.`,
    'The first one is the cover. Select a photo to crop, adjust or filter it, or to make it the cover.',
    // Visible privacy care for minors' media (Family Console Wave 1).
    ...(activeProfile || profile?.supervision_state === 'supervised' ? ['Location data is removed from photos and videos before upload.'] : []),
  ];

  const mediaBlock = (
    <MediaSection
      items={mediaItems}
      uploadOf={uploadOf}
      onFiles={handleFileUpload}
      selectedId={selectedMediaId}
      onSelect={setSelectedMediaId}
      onRemove={removeMediaFile}
      onRetry={id => queue.retry(id)}
      onEdit={(id, tool) => {
        const file = mediaFiles.find(f => f.id === id);
        if (file) openEditorFor(file, tool);
      }}
      onCover={id => setMediaFiles(prev => [...moveToCover(prev, id)])}
      onMove={moveMedia}
      onVideoMeta={noteVideoMeta}
      infoLines={mediaInfo}
    />
  );

  // The post's story — media and caption — as ONE block, so the golf steps
  // can host it on their last step (Oct 28 2026). Every other post type lays
  // the same two parts out on its one page, the caption with its hashtags.
  const postFields = (
    <div className="flex flex-col gap-3">
      {mediaBlock}
      <CaptionPanel caption={caption} onCaption={setCaption} maxCaption={MAX_CAPTION_LENGTH} captionRef={captionRef} />
    </div>
  );

  // Every post type wears the mechanical dialect (Nov 23 2026 for a golf
  // round; Tom's General post spec, Nov 26 2026, for the rest): its own
  // palette inside `.ea-mech`, a full screen on a phone and a centred dialog
  // on a desktop. A golf round's width follows its step; the one-page
  // composer's is its own class (`.ea-mech-compose`).
  // The sport row, handed to the golf section's step frame, which draws it
  // beside its step counter: the same two doors — Change (the picker) and
  // Remove sport.
  const golfLead = (
    <div className="flex items-center gap-1 min-w-0" data-post-type-compact="">
      <button
        type="button"
        onClick={() => setShowSportSelector(true)}
        className="ea-mech-btn inline-flex min-h-[44px] items-center gap-2 rounded-lg text-left"
        aria-label="Change sport"
      >
        <span className="text-sm font-semibold text-[color:var(--mech-text)]">{isGolf ? getSportDefinition(postType as SportKey).display_name : ''}</span>
        <span className="text-[13px] font-medium text-[color:var(--mech-accent-light)]">Change</span>
      </button>
      <button
        type="button"
        data-post-type-clear=""
        aria-label="Remove sport"
        onClick={() => {
          setPostType('general');
          setStatLineData(null);
        }}
        className="ea-mech-btn inline-flex min-h-[44px] items-center rounded-lg px-2 text-[13px] text-[color:var(--mech-text-soft)]"
      >
        Remove
      </button>
    </div>
  );

  // The preview's post: the real feed card's row, built from what is entered (D3).
  const previewPost = showPreview
    ? ({
        id: 'preview-post',
        caption: caption.trim() || null,
        sport_key: isGeneral ? null : postType,
        stats_data: isStatLineSport && statLineData && statLineHasContent(statLineData) ? statLineData : null,
        visibility: POST_VISIBILITY,
        created_at: new Date().toISOString(),
        likes_count: 0,
        comments_count: 0,
        saves_count: 0,
        status: 'published',
        post_category: defaultPostCategory ?? null,
        profile: {
          id: account?.id ?? userId,
          first_name: account?.first_name ?? null,
          last_name: account?.last_name ?? null,
          full_name: account?.full_name ?? null,
          avatar_url: account?.avatar_url ?? null,
          handle: account?.handle ?? null,
        },
        media: mediaFiles.map((file, index) => ({
          id: `preview-media-${index}`,
          media_url: file.url,
          media_type: file.type,
          thumbnail_url: file.posterPreviewUrl ?? null,
          display_order: index,
        })),
        likes: [],
        attached_plate: attached,
        location: location?.label ?? null,
        hashtags,
        tagged_profiles: taggedProfilesData.map(person => {
          const [first, ...rest] = person.name.split(' ');
          return { id: person.id, first_name: first ?? null, last_name: rest.join(' ') || null, full_name: person.name, avatar_url: person.avatarUrl };
        }),
      } as unknown as PostCardPost)
    : null;

  const restoreDraft = (draft: ComposerDraft) => {
    setCaption(draft.caption);
    setHashtags(draft.hashtags);
    setVisibility(draft.visibility);
    if (draft.people) setTaggedProfilesData(draft.people);
    if (draft.attached) setAttached(draft.attached);
    if (draft.location) setLocation(draft.location);
    if (draft.postType !== postType) {
      setPostType(draft.postType as SportKey | 'general');
    }
    if (draft.golf) {
      // Remount the slot with the seed; the section reports
      // the seeded value up on mount (G1).
      setGolfSeed(draft.golf);
      setSportSectionResetKey(k => k + 1);
    }
    if (draft.mediaCount) void restoreStashedMedia(draft.mediaOrder);
    setDraftKept(draft.kept === true);
    setAvailableDraft(null);
  };
  const dismissDraft = () => {
    clearComposerDraft();
    // Bytes of work under way stay (their uploads are running); the draft's go when nothing else is attached.
    if (mediaFiles.length === 0) clearComposerStash();
    setAvailableDraft(null);
  };

  return (
    <div className="ea-mech ea-mech-overlay fixed inset-0 flex items-stretch sm:items-center justify-center z-50 sm:p-4">
      {/* Closing with work in it. A General post offers Save draft (A11, D1);
          a golf round and a sport's stat line keep the two-way confirm (their
          entries do not ride the draft). */}
      {isGeneral ? (
        <ChoiceDialog
          isOpen={confirmOpen}
          hook="save-draft"
          title="Save draft?"
          line={keptPending ? 'It is kept on this device and replaces the draft you saved earlier.' : 'It is kept on this device until you post or discard it.'}
          onDismiss={cancelDiscard}
          actions={[
            { label: 'Save draft', tone: 'primary', onClick: saveDraftAndClose, hook: 'save' },
            { label: 'Discard', tone: 'danger', onClick: confirmDiscard, hook: 'discard' },
            { label: 'Keep editing', tone: 'text', onClick: cancelDiscard, hook: 'keep' },
          ]}
        />
      ) : (
        <ConfirmModal
          isOpen={confirmOpen}
          title={COPY.FORMS.DISCARD_TITLE}
          message={COPY.FORMS.DISCARD_CONFIRM}
          confirmText={COPY.FORMS.DISCARD_ACTION}
          cancelText={COPY.FORMS.KEEP_EDITING}
          onConfirm={confirmDiscard}
          onCancel={cancelDiscard}
        />
      )}
      <div
        className={`ea-mech-dialog w-full flex flex-col sm:py-5 ${isGolf ? `transition-[max-width] duration-[260ms] ${GOLF_FRAME_WIDTH[golfFrame]}` : 'ea-mech-compose'}`}
        data-composer-frame={isGolf ? golfFrame : 'compose'}
      >
        {/* Header (C1) */}
        <div className={`flex items-center justify-between min-h-[44px] shrink-0 px-4 pt-[calc(0.5rem+env(safe-area-inset-top))] sm:pt-0 ${isGolf ? 'sm:px-5' : 'sm:px-6'}`}>
          <h2 className="ea-mech-title">Create Post</h2>
          <button
            onClick={requestClose}
            className="ea-mech-close inline-flex items-center justify-center"
            aria-label="Close modal"
          >
            <FaIcon icon={faXmark} />
          </button>
        </div>

        {/* Content - Scrollable. For golf the step frame fills it: its own
            body scrolls and its footer stays at the bottom. */}
        <div className={isGolf ? 'flex-1 min-h-0 flex flex-col overflow-y-auto' : 'ea-mech-scroll flex-1 min-h-0 overflow-y-auto px-4 pb-3 pt-1 sm:px-6'}>
          {/* A draft on offer — restore is a choice, never automatic. ONE
              line: the icon, what it is, Restore as a text button, Dismiss as
              an icon. A SAVED draft stays on offer until it is decided; a
              crash's leftover steps aside once a caption is typed. */}
          {availableDraft && (availableDraft.kept || caption.trim() === '') && (
            <div
              className={`flex h-11 shrink-0 items-center rounded-xl pl-3 ${isGolf ? 'mx-4 sm:mx-5 mt-1' : 'mb-3'}`}
              style={{ backgroundColor: 'var(--mech-selected-fill)', boxShadow: 'inset 0 0 0 1px var(--mech-selected-border)' }}
              data-draft-banner={availableDraft.kept ? 'saved' : ''}
            >
              <FaIcon icon={faClockRotateLeft} className="ea-mech-icon text-[16px]" />
              <p className="ml-2 min-w-0 flex-1 truncate text-[13px] font-medium text-[color:var(--mech-text)]">{availableDraft.kept ? 'Saved draft' : 'Unfinished post'}</p>
              <button type="button" onClick={() => restoreDraft(availableDraft)} className="ea-mech-btn h-11 shrink-0 px-2 text-[13px] font-semibold text-[color:var(--mech-accent-light)]" data-draft-restore="">
                Restore
              </button>
              <button type="button" onClick={dismissDraft} aria-label={availableDraft.kept ? 'Delete the saved draft' : 'Dismiss the unfinished post'} className="ea-mech-btn inline-flex h-11 w-11 shrink-0 items-center justify-center text-[14px] text-[color:var(--mech-text-soft)]" data-draft-dismiss="">
                <FaIcon icon={faXmark} />
              </button>
            </div>
          )}

          {/* The one page (C2–C6, C8). A golf round's steps draw their own
              frame below; its last step hosts the story (finishSlot). */}
          {!isGolf && (
            <div className="flex flex-col gap-3">
              {/* Post type line (C2): the plate, the name, Change — one door to
                  the picker. A chosen sport is cleared beside it, never inside. */}
              <div className="flex min-h-[44px] min-w-0 items-center gap-1" data-post-type-line="">
                <button
                  type="button"
                  onClick={() => setShowSportSelector(true)}
                  className="ea-mech-btn inline-flex min-h-[44px] min-w-0 items-center gap-2.5 rounded-lg text-left"
                >
                  <span aria-hidden="true" className="ea-mech-recess inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] text-[color:var(--mech-accent-light)]">
                    {isGeneral ? <PencilIcon size={16} /> : <FaIcon icon={sportIcon(postType as SportKey)} className="text-[14px]" />}
                  </span>
                  <span className="min-w-0 truncate text-sm font-semibold text-[color:var(--mech-text)]">
                    {isGeneral ? 'General post' : getSportDefinition(postType as SportKey).display_name}
                  </span>
                  <span className="shrink-0 text-[13px] font-medium text-[color:var(--mech-accent-light)]">Change</span>
                </button>
                {!isGeneral && (
                  <button
                    type="button"
                    data-post-type-clear=""
                    aria-label="Remove sport"
                    onClick={() => {
                      setPostType('general');
                      setStatLineData(null);
                    }}
                    className="ea-mech-btn inline-flex min-h-[44px] shrink-0 items-center rounded-lg px-2 text-[13px] text-[color:var(--mech-text-soft)]"
                  >
                    Remove
                  </button>
                )}
              </div>

              <div className="ea-mech-compose-grid">
                <div className="ea-mech-compose-col">
                  {mediaBlock}
                  <CaptionPanel
                    caption={caption}
                    onCaption={setCaption}
                    maxCaption={MAX_CAPTION_LENGTH}
                    captionRef={captionRef}
                    hashtags={{
                      list: hashtags,
                      max: MAX_HASHTAGS,
                      onAdd: addHashtag,
                      onRemove: removeHashtag,
                      typed: customHashtag,
                      onTyped: setCustomHashtag,
                      suggestions: currentHashtags,
                    }}
                  />
                </div>
                <div className="ea-mech-compose-col">
                  {/* Stat-line sport form (ice hockey, volleyball, …) */}
                  {isStatLineSport && (
                    <StatLineForm
                      sportKey={postType as SportKey}
                      value={statLineData ?? emptyStatLine(postType as SportKey)}
                      onChange={setStatLineData}
                    />
                  )}
                  <DetailsPanel>
                    <TagPeopleRow people={taggedProfilesData} onAdd={() => setShowTagModal(true)} onRemove={removeTaggedPerson} />
                    <AttachRow
                      label={attached ? attachRowLabel(attached) : null}
                      headline={attached ? `${attached.headline}${attached.unit ? ` ${attached.unit}` : ''}` : null}
                      colour={attached ? plateColour(attached) : null}
                      onOpen={() => setShowAttachPicker(true)}
                      onRemove={() => setAttached(null)}
                    />
                    <LocationRow label={location?.label ?? null} onOpen={() => setShowLocation(true)} onRemove={() => setLocation(null)} />
                  </DetailsPanel>
                  {/* Who sees it: the ACCOUNT's call (Oct 9 2026, Tom) — never a
                      per-post audience. A General post has no switch at all
                      (Nov 26 2026); a sport's post keeps the feed switch (269):
                      off, it still stands on the profile. */}
                  {!isGeneral && (
                    <div data-composer-audience="">
                      <FeedToggle on={feedSwitch} onChange={setFeedSwitch} kind={feedKind} place={defaultPostCategory === 'training' ? 'in Training' : undefined} accountVisibility={account?.visibility ?? null} />
                    </div>
                  )}
                </div>
              </div>
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
              onFinish={() => { void handleSubmit(); }}
              busy={isSubmitting}
              busyLabel={uploadingLine(mediaFiles.map(f => uploads.itemFor(f.id)?.progress)) ?? undefined}
              finishSlot={postFields}
              lead={sportKey === 'golf' ? golfLead : undefined}
              onFrame={sportKey === 'golf' ? setGolfFrame : undefined}
            />
          ))}
        </div>

        {/* Footer (C7) — a golf round's steps draw their own (StepFlow), so
            the composer's stays off while golf is the post type. The eye key
            and the slide: posting is always the slide's (R5). */}
        {!isGolf && (
          <div className="shrink-0 px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-2 sm:px-6 sm:pb-1" data-compose-footer="">
            {/* Why the slide waits, when the reason is a video over the limit:
                a consequence the person must act on, so it stays in view
                (Videos program, 296: a full game lives on YouTube and is linked). */}
            {hasTooLongVideo && (
              <p className="mb-2 text-[13px] leading-5 text-[color:var(--mech-text-soft)]" data-composer-hint="">
                Trim the video in the editor, or{' '}
                <Link href="/videos/new" className="font-semibold text-[color:var(--mech-accent-light)] underline-offset-2 hover:underline" data-full-game-link="">
                  add the full game as a YouTube video
                </Link>
              </p>
            )}
            <div className="ea-mech-compose-foot flex min-w-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setShowPreview(true)}
                disabled={nothingEntered}
                aria-label="Preview"
                className="ea-mech-outline-key inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] disabled:opacity-[0.45]"
                data-compose-preview-key=""
              >
                <EyeIcon size={20} />
              </button>
              <SlideToConfirm
                tone="post"
                className="min-w-0 flex-1"
                label={slideWords({ uploading, posting: false, posted: false })}
                busyLabel="Posting"
                doneLabel="Posted"
                ariaLabel="Slide to post"
                onConfirm={() => { void handleSubmit(); }}
                disabled={!readyToPost}
                busy={isSubmitting}
                done={posted}
              />
            </div>
          </div>
        )}
      </div>

      {/* Preview (D3): the real feed card, one Edit key. */}
      {previewPost && (
        <PreviewOverlay post={previewPost} currentUserId={account?.id ?? userId} onClose={() => setShowPreview(false)} />
      )}

      {/* Tag People (A9): the same dialog as the golf flow's. */}
      <TagPeopleModal
        isOpen={showTagModal}
        onClose={() => setShowTagModal(false)}
        existingTags={taggedProfiles}
        onSelectionComplete={handleTagPeopleComplete}
        variant="mech"
        selectionMode={true}
      />

      {/* Attach activity (A1, D2) and Location (A10). */}
      {showAttachPicker && (
        <AttachPicker onClose={closeAttachPicker} profileId={activeProfile?.id ?? null} current={attached} onPick={setAttached} />
      )}
      <LocationDialog isOpen={showLocation} onClose={() => setShowLocation(false)} onPick={setLocation} />

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
          initialTool={editorTool}
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
