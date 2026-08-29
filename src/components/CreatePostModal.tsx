'use client';

import { useState, useCallback, useRef, useEffect, type ComponentType } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { shouldEnterScorerAfterCreate } from '@/lib/golf/round-route';
import { calcPlayerTotals } from '@/lib/golf/scoring';
import { useToast } from '@/components/Toast';
import { getTagOptions, getHashtagSuggestions } from '@/lib/sports/post-tags';
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
import { MediaEditor } from '@/components/media-editor';
import CaptureInputs from '@/components/media/CaptureInputs';
import { validateFiles } from '@/lib/media/validation';
import { recipeEnvelope } from '@/lib/media/recipes';
import { loadComposerDraft, saveComposerDraft, clearComposerDraft, type ComposerDraft } from '@/lib/posts/composer-draft';
import { uploadPostMedia } from '@/lib/media/upload';
import type { EditRecipe, EditedMedia, EditorConfig, MediaAsset } from '@/lib/media/types';

interface CreatePostModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  onPostCreated?: (post: unknown) => void;
  defaultSportKey?: SportKey | 'general'; // Optional: pre-select a sport
  /** Cross-cutting category stamped on the created post (077) — the vitals
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
  /** Video cover frame from the editor — uploaded as post_media.thumbnail_url. */
  posterBlob?: Blob;
  /** Output metadata from the editor's probe — persisted to post_media. */
  width?: number;
  height?: number;
  durationSeconds?: number;
  /** True when `file` is a rendered blob distinct from `sourceFile` — drives
   *  the non-destructive original upload (source_url, migration 120). */
  edited?: boolean;
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
  visibility: 'public' | 'private';
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
  defaultPostCategory
}: CreatePostModalProps) {
  const { showSuccess, showError } = useToast();
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
  const wasOpenRef = useRef(false);
  // Crash-recovery draft (dummy-proofing round): offered back as a notice on
  // open, never silently applied. Deliberate exits (discard confirm, post)
  // clear it; only an unexpected death leaves one behind.
  const [availableDraft, setAvailableDraft] = useState<ComposerDraft | null>(null);
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setPostType(defaultSportKey);
      setAvailableDraft(loadComposerDraft());
    }
    wasOpenRef.current = isOpen;
  }, [isOpen, defaultSportKey]);

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
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [isOpen, postType, caption, hashtags, selectedTags, visibility]);

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

  // Reset form (back to the caller's default sport, not hardcoded 'general' —
  // resetting to 'general' silently dropped every caller's defaultSportKey
  // after the first post)
  const reset = () => {
    setPostType(defaultSportKey);
    setCaption('');
    setSelectedTags([]);
    setHashtags([]);
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
    setSportSectionResetKey(k => k + 1);
  };

  // Close-and-reset, used directly by post-success paths (never confirm
  // after a save). User-initiated closes (X, Cancel) go through
  // requestClose below, which asks before discarding unsaved work.
  const closeAndReset = () => {
    // Explicit exit (confirmed discard or successful post) — the draft's job
    // is crash recovery, not resurrecting decisions.
    clearComposerDraft();
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
  const handleFileUpload = useCallback((files: FileList) => {
    if (files.length === 0) return;
    const { accepted, rejected } = validateFiles(Array.from(files), {
      maxBytes: 50 * 1024 * 1024,
      allowVideo: true,
      maxCount: MAX_MEDIA_FILES,
      existingCount: mediaFiles.length,
    });
    for (const r of rejected) {
      showError('File not added', r.message);
    }
    if (accepted.length === 0) return;
    setEditingExistingId(null);
    setEditorAssets(
      accepted.map(file => ({
        id: `${Date.now()}-${Math.random()}`,
        file,
        kind: file.type.startsWith('video/') ? 'video' as const : 'image' as const,
      }))
    );
  }, [mediaFiles.length, showError]);

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
      width: r.width,
      height: r.height,
      durationSeconds: r.durationSeconds,
      edited: r.edited,
    });
    if (editingExistingId) {
      const replaced = results[0];
      setMediaFiles(prev =>
        prev.map(f => {
          if (f.id !== editingExistingId || !replaced) return f;
          if (f.preview) URL.revokeObjectURL(f.preview); // old blob preview
          return { ...toMediaFile(replaced), id: f.id };
        })
      );
    } else {
      setMediaFiles(prev => [...prev, ...results.map(toMediaFile)]);
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
    if (file?.preview) {
      URL.revokeObjectURL(file.preview);
    }
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

  // Upload one media file (+ its video poster frame, when the editor made
  // one, + the untouched ORIGINAL when the render differs — non-destructive
  // media, migration 120; a missing original degrades to re-editing the
  // render, never fails the post).
  const uploadMediaWithPoster = async (
    mediaFile: MediaFile
  ): Promise<{ url: string; thumbnailUrl?: string; sourceUrl?: string }> => {
    if (!mediaFile.file) return { url: mediaFile.url };
    // Acting-as: media belongs to the athlete's post, so it must land under
    // the ATHLETE's storage prefix (server validates via the acting-as gate).
    const targetId = activeProfile?.id;
    const { url } = await uploadPostMedia(mediaFile.file, targetId);
    let thumbnailUrl: string | undefined;
    if (mediaFile.posterBlob) {
      try {
        const poster = new File([mediaFile.posterBlob], 'poster.jpg', { type: 'image/jpeg' });
        thumbnailUrl = (await uploadPostMedia(poster, targetId)).url;
      } catch (err) {
        // A poster is a nice-to-have — never fail the post over it
        console.warn('Poster upload failed:', err);
      }
    }
    let sourceUrl: string | undefined;
    if (mediaFile.edited && mediaFile.sourceFile) {
      try {
        sourceUrl = (await uploadPostMedia(mediaFile.sourceFile, targetId)).url;
      } catch (err) {
        console.warn('Original upload failed (render still posts):', err);
      }
    }
    return { url, thumbnailUrl, sourceUrl };
  };

  // Validation
  const isValidForSubmission = () => {
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
          visibility,
          mediaFiles,
          uploadMediaWithPoster,
          showSuccess,
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
        const scorerPath = shouldEnterScorerAfterCreate(groupPost);
        if (scorerPath) router.push(scorerPath);
        return;
      }

      // Upload media files (for individual posts)
      const uploadedMedia = await Promise.all(
        mediaFiles.map(async (file) => {
          const { url, thumbnailUrl, sourceUrl } = await uploadMediaWithPoster(file);
          return { ...file, url, thumbnailUrl, sourceUrl };
        })
      );

      // Prepare post data (userId comes from auth)
      const postData = {
        postType,
        caption: caption.trim(),
        tags: selectedTags,
        hashtags,
        visibility,
        media: uploadedMedia.map((file, index) => ({
          url: file.url,
          type: file.type,
          sortOrder: index,
          // server persists as post_media.thumbnail_url (posts/route.ts)
          thumbnailUrl: file.thumbnailUrl,
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
        // Cross-cutting category (077) — e.g. the vitals tab's training posts.
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

      showSuccess('Post created successfully! 🎉');

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

  // Clean up previews on unmount
  useEffect(() => {
    return () => {
      mediaFiles.forEach(file => {
        if (file.preview) {
          URL.revokeObjectURL(file.preview);
        }
      });
    };
  }, [mediaFiles]);

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
            <CaptureInputs onFiles={handleFileUpload} allowVideo>
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
                      <video src={file.url} className="w-full h-full object-cover" />
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
                className="text-sm text-brand-fg hover:text-brand-fg-strong"
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

          {/* Visibility */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-secondary mb-3">Visibility</label>
            <div className="flex gap-4">
              <label className="flex items-center cursor-pointer">
                <input
                  type="radio"
                  value="public"
                  checked={visibility === 'public'}
                  onChange={(e) => setVisibility(e.target.value as 'public' | 'private')}
                  className="mr-2"
                />
                <span className="text-sm">
                  <i className="fas fa-globe mr-1 text-muted"></i>
                  Public
                </span>
              </label>
              <label className="flex items-center cursor-pointer">
                <input
                  type="radio"
                  value="private"
                  checked={visibility === 'private'}
                  onChange={(e) => setVisibility(e.target.value as 'public' | 'private')}
                  className="mr-2"
                />
                <span className="text-sm">
                  <i className="fas fa-lock mr-1 text-muted"></i>
                  Private
                </span>
              </label>
            </div>
          </div>
        </div>

        {/* Footer.
            Stacks below `sm`: as a single non-wrapping row, the hint + Cancel +
            Preview + Create Post overflowed the modal on every phone width and
            clipped the primary submit button off the right edge (375px: the
            "Create Post" button ran to 424px in a 375px viewport). */}
        <div className="flex flex-col gap-3 p-4 border-t border-border bg-surface-muted sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="text-sm text-tertiary">
            {!isValidForSubmission() && (
              <span className="text-red-600 dark:text-red-400">
                <i className="fas fa-exclamation-circle mr-1"></i>
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
                  : 'Add caption or media to post'
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
                  {isLiveSetup ? 'Starting…' : 'Creating...'}
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
          visibility={visibility}
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
          selectedSport={postType}
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
  visibility,
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
                    Just now • {visibility === 'public' ? '🌍 Public' : '🔒 Private'}
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
                        <video src={file.url} className="w-full h-full object-cover" />
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