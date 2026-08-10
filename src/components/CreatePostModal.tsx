'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { shouldEnterScorerAfterCreate } from '@/lib/golf/round-route';
import { calcPlayerTotals } from '@/lib/golf/scoring';
import { useToast } from '@/components/Toast';
import { getTagOptions, getHashtagSuggestions } from '@/lib/sports/post-tags';
import MediaTile from '@/components/media/MediaTile';
import GolfScorecardForm from '@/components/golf/GolfScorecardForm';
import TagPeopleModal from '@/components/TagPeopleModal';
import SportSelector from '@/components/SportSelector';
import MultiPlayerScorecardGrid, { type PlayerScoreData, type PlayerHoleScore } from '@/components/golf/MultiPlayerScorecardGrid';
import SharedRoundQuickView from '@/components/golf/SharedRoundQuickView';
import { getSportDefinition, type SportKey } from '@/lib/sports/SportRegistry';
import StatLineForm, { emptyStatLine, statLineHasContent } from '@/components/StatLineForm';
import { getStatSchema, type StatLineData } from '@/lib/sports/stat-schemas';
import type { HoleData, GolfCourse } from '@/types/golf';
import type { CompleteGolfScorecard, ParticipantRole } from '@/types/group-posts';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useDirtyClose } from '@/hooks/useDirtyClose';
import ConfirmModal from '@/components/ConfirmModal';
import { COPY } from '@/lib/copy';
import { MediaEditor } from '@/components/media-editor';
import { validateFiles } from '@/lib/media/validation';
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
}

interface GolfRoundData {
  courseName?: string;
  holesData?: HoleData[];
}

interface ProfileData {
  id: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  name?: string;
  avatar_url?: string;
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
  golfData: GolfRoundData | null;
  taggedPeople?: {id: string; name: string}[];
  holeParSource?: { hole: number; par: number }[] | null;
  // Shared round data
  roundType?: 'individual' | 'shared';
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
  const { activeProfile } = useAuth();
  const captionRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Post type and content
  const [postType, setPostType] = useState<SportKey | 'general'>(defaultSportKey);
  const [showSportSelector, setShowSportSelector] = useState(false);

  // The modal stays mounted with isOpen toggling, so the useState initializer
  // above only ever sees the FIRST defaultSportKey. Re-apply it on each open
  // transition (ref-guarded so a prop change mid-composition can't clobber
  // what the user picked).
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setPostType(defaultSportKey);
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

  // Golf specific data
  const [golfRoundData, setGolfRoundData] = useState<GolfRoundData | null>(null);

  // Shared round specific data
  const [roundType, setRoundType] = useState<'individual' | 'shared'>('individual');
  const [sharedRoundParticipants, setSharedRoundParticipants] = useState<string[]>([]);
  const [sharedRoundParticipantsData, setSharedRoundParticipantsData] = useState<{id: string; name: string; avatar_url?: string}[]>([]);
  const [showParticipantModal, setShowParticipantModal] = useState(false);
  const [sharedRoundDetails, setSharedRoundDetails] = useState({
    courseName: '',
    date: new Date().toISOString().split('T')[0], // Today's date
    holesPlayed: 18,
    roundTypeIndoorOutdoor: 'outdoor' as 'outdoor' | 'indoor',
    gameFormat: 'stroke' as 'stroke' | 'stableford' | 'match',
    teeColor: '',
    weather: '',
    temperature: '',
    wind: '',
    // "Already played" rounds post as FINAL immediately (no LIVE badge, no
    // resume banner) — for logging rounds after the fact
    alreadyPlayed: false,
  });
  // Smart default: picking a past date implies "already played" — but an
  // explicit tap on the toggle wins and stops the auto-flip
  const roundTimingTouchedRef = useRef(false);

  // "Playing now" is ONE flow (live round, friends optional) — it always
  // runs on the shared-round rails, solo just means zero invitees.
  // A constraint on the current state, not a side effect: apply it during
  // render so an invalid roundType never reaches the UI for a frame.
  if (postType === 'golf' && !sharedRoundDetails.alreadyPlayed && roundType !== 'shared') {
    setRoundType('shared');
  }

  // Golf course search for shared rounds
  const [courseSearchOpen, setCourseSearchOpen] = useState(false);
  const [courseSearchQuery, setCourseSearchQuery] = useState('');
  const [availableCourses, setAvailableCourses] = useState<GolfCourse[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState<GolfCourse | null>(null);

  // Course hole data (par and yardage per hole)
  const [courseHoleData, setCourseHoleData] = useState<{ hole: number; par: number; yardage?: number }[]>([]);
  const [manualParEntry, setManualParEntry] = useState<number[]>([]);
  const [manualYardageEntry, setManualYardageEntry] = useState<number[]>([]);

  // Shared round score entry
  const [playerScores, setPlayerScores] = useState<PlayerScoreData[]>([]);

  // Visibility and submission
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  // Shared media editor session (null = closed). editingExistingId set when
  // re-editing an already-attached asset (result replaces it in place).
  const [editorAssets, setEditorAssets] = useState<MediaAsset[] | null>(null);
  const [editingExistingId, setEditingExistingId] = useState<string | null>(null);

  // Tagging people
  const [taggedProfiles, setTaggedProfiles] = useState<string[]>([]);
  const [taggedProfilesData, setTaggedProfilesData] = useState<{id: string; name: string}[]>([]);
  const [showTagModal, setShowTagModal] = useState(false);

  // Character limits
  const MAX_CAPTION_LENGTH = 500;
  const MAX_HASHTAGS = 10;
  const MAX_MEDIA_FILES = 10;

  const COMPOSER_EDITOR_CONFIG: EditorConfig = {
    aspectRatios: ['free', '1:1', '4:5', '16:9'],
    allowVideo: true, // videos pass through untouched until the video phase
    maxAssets: MAX_MEDIA_FILES,
    output: { maxDimension: 2048, mime: 'image/jpeg', quality: 0.9 },
  };

  // Search for golf courses (for shared rounds)
  const searchCourses = useCallback(async (query: string) => {
    if (query.length < 2) {
      setAvailableCourses([]);
      return;
    }

    setSearchLoading(true);
    try {
      const response = await fetch(`/api/golf/courses?q=${encodeURIComponent(query)}&limit=8`);
      if (response.ok) {
        const data = await response.json();
        setAvailableCourses(data.courses || []);
      } else {
        console.error('Failed to search golf courses — status:', response.status);
      }
    } catch (e) {
      console.error('Failed to search golf courses:', e);
      setAvailableCourses([]);
    } finally {
      setSearchLoading(false);
    }
  }, []);

  // Select a course from search results (for shared rounds)
  const selectCourse = useCallback((course: GolfCourse) => {
    setSelectedCourse(course);
    setSharedRoundDetails(prev => ({
      ...prev,
      courseName: course.name
    }));
    setCourseSearchOpen(false);
    setCourseSearchQuery('');
    setAvailableCourses([]);

    // Auto-populate par and yardage from course data
    const teeKey = (sharedRoundDetails.teeColor || 'white') as keyof typeof course.holes[0]['yardage'];
    const holeData = course.holes
      .filter(hole => hole.number <= sharedRoundDetails.holesPlayed)
      .map(hole => ({
        hole: hole.number,
        par: hole.par,
        yardage: hole.yardage[teeKey] || hole.yardage.white || hole.yardage.blue || 400
      }));
    setCourseHoleData(holeData);

    // Clear manual entry since we have course data
    setManualParEntry([]);
    setManualYardageEntry([]);
  }, [sharedRoundDetails.teeColor, sharedRoundDetails.holesPlayed]);

  // Initialize player scores when participants are added
  const initializePlayerScores = useCallback((participants: {id: string; name: string; avatar_url?: string}[], holes: number) => {
    setPlayerScores(prev => {
      // Get existing player IDs to avoid duplicates
      const existingIds = new Set(prev.map(p => p.participant_id));

      // Only initialize scores for NEW players
      const newPlayers = participants
        .filter(p => !existingIds.has(p.id))
        .map(participant => ({
          participant_id: participant.id,
          profile: {
            id: participant.id,
            full_name: participant.name,
            avatar_url: participant.avatar_url
          },
          hole_scores: Array.from({ length: holes }, (_, i) => ({
            hole_number: i + 1,
            strokes: undefined,
            putts: undefined,
            fairway_hit: undefined,
            green_in_regulation: undefined
          }))
        }));

      // Merge with existing players
      return [...prev, ...newPlayers];
    });
  }, []);

  // Handle score change for a specific player and hole
  const handlePlayerScoreChange = useCallback((playerId: string, holeNum: number, data: Partial<PlayerHoleScore>) => {
    setPlayerScores(prevScores =>
      prevScores.map(playerScore => {
        if (playerScore.participant_id === playerId) {
          return {
            ...playerScore,
            hole_scores: playerScore.hole_scores.map(holeScore =>
              holeScore.hole_number === holeNum
                ? { ...holeScore, ...data }
                : holeScore
            )
          };
        }
        return playerScore;
      })
    );
  }, []);

  // Reset form (back to the caller's default sport, not hardcoded 'general' —
  // resetting to 'general' silently dropped every caller's defaultSportKey
  // after the first post)
  const reset = () => {
    setPostType(defaultSportKey);
    setCaption('');
    setSelectedTags([]);
    setHashtags([]);
    setMediaFiles([]);
    setGolfRoundData(null);
    setStatLineData(null);
    setVisibility('public');
    setShowHashtagSuggestions(false);
    setCustomHashtag('');
    setShowPreview(false);
    setTaggedProfiles([]);
    setTaggedProfilesData([]);
    setShowTagModal(false);
    // Reset shared round data
    setRoundType('individual');
    setSharedRoundParticipants([]);
    setSharedRoundParticipantsData([]);
    setShowParticipantModal(false);
    setSharedRoundDetails({
      courseName: '',
      date: new Date().toISOString().split('T')[0],
      holesPlayed: 18,
      roundTypeIndoorOutdoor: 'outdoor',
      gameFormat: 'stroke',
      teeColor: '',
      weather: '',
      temperature: '',
      wind: '',
      alreadyPlayed: false,
    });
    roundTimingTouchedRef.current = false;
    // Reset course search
    setCourseSearchOpen(false);
    setCourseSearchQuery('');
    setAvailableCourses([]);
    setSearchLoading(false);
    setSelectedCourse(null);
    // Reset course hole data
    setCourseHoleData([]);
    setManualParEntry([]);
    setManualYardageEntry([]);
    // Reset score entry
    setPlayerScores([]);
  };

  // Close-and-reset, used directly by post-success paths (never confirm
  // after a save). User-initiated closes (X, Cancel) go through
  // requestClose below, which asks before discarding unsaved work.
  const closeAndReset = () => {
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
    golfRoundData !== null ||
    statLineData !== null ||
    // NOT roundType: a live golf round pins it to 'shared' during render
    // (solo is a shared round with zero invitees), so counting it here made
    // the composer dirty the instant it opened and every close prompted to
    // discard work the user had not started. The fields below are the real
    // signal that something was entered.
    sharedRoundParticipants.length > 0 ||
    selectedCourse !== null ||
    sharedRoundDetails.courseName.trim() !== '' ||
    manualParEntry.length > 0 ||
    manualYardageEntry.length > 0 ||
    playerScores.length > 0;

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

  // Handle shared round participant selection
  const handleParticipantSelection = (selectedIds: string[], selectedProfiles?: ProfileData[]) => {
    // Merge new selections with existing participants (don't replace)
    setSharedRoundParticipants(prev => {
      const newIds = selectedIds.filter(id => !prev.includes(id));
      return [...prev, ...newIds];
    });

    if (selectedProfiles && selectedProfiles.length > 0) {
      const profilesData = selectedProfiles.map(profile => {
        const name = profile.first_name && profile.last_name
          ? `${profile.first_name} ${profile.last_name}`
          : profile.full_name || profile.name || 'Unknown User';
        return { id: profile.id, name, avatar_url: profile.avatar_url };
      });

      // Merge new profiles with existing participant data (don't replace)
      setSharedRoundParticipantsData(prev => {
        const existingIds = new Set(prev.map(p => p.id));
        const newProfiles = profilesData.filter(p => !existingIds.has(p.id));
        return [...prev, ...newProfiles];
      });

      // Score initialization is now handled by useEffect
    }
  };

  // Remove participant
  const removeParticipant = (profileId: string) => {
    setSharedRoundParticipants(prev => prev.filter(id => id !== profileId));
    setSharedRoundParticipantsData(prev => prev.filter(p => p.id !== profileId));
    // Also remove from scores
    setPlayerScores(prev => prev.filter(p => p.participant_id !== profileId));
  };

  // Initialize scores when participants are added or holes change
  useEffect(() => {
    if (sharedRoundParticipantsData.length > 0) {
      initializePlayerScores(sharedRoundParticipantsData, sharedRoundDetails.holesPlayed);
    }
  }, [sharedRoundDetails.holesPlayed, sharedRoundParticipantsData, initializePlayerScores]);

  // Handle custom hashtag input
  const handleCustomHashtagSubmit = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && customHashtag.trim()) {
      e.preventDefault();
      addHashtag(customHashtag.trim());
      setCustomHashtag('');
    }
  };

  // Generate golf caption from stats
  const generateGolfCaption = () => {
    if (!golfRoundData || postType !== 'golf') return '';

    const { holesData, courseName } = golfRoundData;
    const scoredHoles = holesData?.filter((h: HoleData) => h.score !== undefined) || [];

    if (scoredHoles.length === 0) return '';

    const totalScore = scoredHoles.reduce((sum: number, h: HoleData) => sum + (h.score || 0), 0);
    const totalPar = scoredHoles.reduce((sum: number, h: HoleData) => sum + h.par, 0);
    const differential = totalScore - totalPar;

    let caption = `Shot ${totalScore}`;
    if (differential === 0) caption += ' (Even)';
    else if (differential > 0) caption += ` (+${differential})`;
    else caption += ` (${differential})`;

    if (courseName) caption += ` at ${courseName}`;

    // Add some stats if available
    const putts = scoredHoles.reduce((sum: number, h: HoleData) => sum + (h.putts || 0), 0);
    if (putts > 0) caption += ` | ${putts} putts`;

    const birdies = scoredHoles.filter((h: HoleData) => h.score === h.par - 1).length;
    if (birdies > 0) caption += ` | ${birdies} ${birdies === 1 ? 'birdie' : 'birdies'}`;

    return caption;
  };

  // Upload one media file (+ its video poster frame, when the editor made one)
  const uploadMediaWithPoster = async (
    mediaFile: MediaFile
  ): Promise<{ url: string; thumbnailUrl?: string }> => {
    if (!mediaFile.file) return { url: mediaFile.url };
    const { url } = await uploadPostMedia(mediaFile.file);
    if (!mediaFile.posterBlob) return { url };
    try {
      const poster = new File([mediaFile.posterBlob], 'poster.jpg', { type: 'image/jpeg' });
      const uploaded = await uploadPostMedia(poster);
      return { url, thumbnailUrl: uploaded.url };
    } catch (err) {
      // A poster is a nice-to-have — never fail the post over it
      console.warn('Poster upload failed:', err);
      return { url };
    }
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

    // Golf posts
    if (postType === 'golf') {
      if (roundType === 'individual') {
        // Individual rounds need scorecard data
        return golfRoundData && golfRoundData.courseName && golfRoundData.holesData?.some((h: HoleData) => h.score !== undefined);
      } else {
        // Shared rounds need at least course name, date, and at least one participant
        // Weather fields are optional - can be added later or left blank
        return (
          sharedRoundDetails.courseName.trim().length > 0 &&
          sharedRoundDetails.date &&
          // Live ("playing now") rounds can be solo; batch shared rounds
          // need at least one other player
          (sharedRoundParticipants.length > 0 || !sharedRoundDetails.alreadyPlayed)
        );
      }
    }

    return false;
  };

  // Submit post
  const handleSubmit = async () => {
    if (!isValidForSubmission()) {
      // Provide specific error message based on post type
      if (postType === 'golf' && roundType === 'shared') {
        const missing: string[] = [];
        if (!sharedRoundDetails.courseName.trim()) missing.push('course name');
        if (!sharedRoundDetails.date) missing.push('date');
        if (sharedRoundParticipants.length === 0 && sharedRoundDetails.alreadyPlayed) missing.push('participants');
        if (sharedRoundDetails.roundTypeIndoorOutdoor === 'outdoor') {
          if (!sharedRoundDetails.weather.trim()) missing.push('weather');
          if (!sharedRoundDetails.temperature.trim()) missing.push('temperature');
          if (!sharedRoundDetails.wind.trim()) missing.push('wind');
        }
        showError('Incomplete shared round', `Please provide: ${missing.join(', ')}`);
      } else {
        showError('Incomplete post', 'Please add content to your post');
      }
      return;
    }

    setIsSubmitting(true);

    try {

      // Handle shared golf rounds differently
      if (postType === 'golf' && roundType === 'shared') {

        // Step 1: Create the round ATOMICALLY — group post, participants,
        // scorecard, and feed post in one server request. If any piece fails
        // the server rolls the whole thing back (no more rounds whose card
        // renders nothing because a follow-up scorecard call died).
        const groupPostResponse = await fetch('/api/group-posts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            type: 'golf_round',
            title: `Golf at ${sharedRoundDetails.courseName}`,
            description: caption.trim() || undefined,
            date: sharedRoundDetails.date,
            location: sharedRoundDetails.courseName,
            visibility: visibility,
            participant_ids: sharedRoundParticipants,
            already_played: sharedRoundDetails.alreadyPlayed || undefined,
            golf_data: {
              course_name: sharedRoundDetails.courseName,
              round_type: sharedRoundDetails.roundTypeIndoorOutdoor,
              game_format: sharedRoundDetails.gameFormat,
              holes_played: sharedRoundDetails.holesPlayed,
              // Real per-hole pars (course search or manual entry) — powers
              // honest to-par + the score-entry modal's par display
              hole_data:
                courseHoleData.length > 0
                  ? courseHoleData
                  : manualParEntry.length > 0 || manualYardageEntry.length > 0
                  ? Array.from({ length: sharedRoundDetails.holesPlayed }, (_, i) => ({
                      hole: i + 1,
                      par: manualParEntry[i] || 4,
                      yardage: manualYardageEntry[i] || undefined,
                    }))
                  : undefined,
              tee_color: sharedRoundDetails.teeColor || undefined,
              weather_conditions: sharedRoundDetails.weather || undefined,
              temperature: sharedRoundDetails.temperature ? parseInt(sharedRoundDetails.temperature) : undefined,
              wind_speed: sharedRoundDetails.wind === 'calm' ? 0 :
                          sharedRoundDetails.wind === 'light' ? 7 :
                          sharedRoundDetails.wind === 'moderate' ? 15 :
                          sharedRoundDetails.wind === 'strong' ? 25 : undefined,
            },
          }),
        });

        if (!groupPostResponse.ok) {
          const errorData = await groupPostResponse.json();
          throw new Error(errorData.error || 'Failed to create shared round');
        }

        const groupPostResult = await groupPostResponse.json();
        const groupPostId = groupPostResult.group_post.id;

        // Step 2: initial scores, if any were entered in the modal (the
        // scorecard itself was created atomically in step 1).
        const hasScores = playerScores.length > 0 && playerScores.some(p =>
          p.hole_scores.some(h => h.strokes !== undefined && h.strokes > 0)
        );

        const scoresPromise = hasScores
          ? fetch('/api/golf/participant-scores', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({
                group_post_id: groupPostId,
                participant_scores: playerScores.map(player => ({
                  participant_id: player.participant_id,
                  hole_scores: player.hole_scores
                    .filter(hole => hole.strokes !== undefined && hole.strokes > 0)
                    .map(hole => {
                      // Add par and yardage from course data if available
                      const holeInfo = courseHoleData.find(h => h.hole === hole.hole_number) ||
                        (manualParEntry.length > 0 || manualYardageEntry.length > 0
                          ? {
                              par: manualParEntry[hole.hole_number - 1] || undefined,
                              yardage: manualYardageEntry[hole.hole_number - 1] || undefined
                            }
                          : {});

                      return {
                        ...hole,
                        par: holeInfo.par,
                        yardage: holeInfo.yardage
                      };
                    })
                }))
              }),
            })
          : Promise.resolve(null);

        const [scoresResult] = await Promise.allSettled([scoresPromise]);

        if (hasScores && (scoresResult.status === 'rejected' || (scoresResult.status === 'fulfilled' && scoresResult.value && !scoresResult.value.ok))) {
          // Surface it — silently losing entered scores erodes trust. The
          // round itself is fine; scores are re-enterable from the post.
          console.error('Failed to save participant scores');
          showError('Round created, but some scores could not be saved. You can re-enter them from the post.');
        }

        // Attach any composer media to the ROUND. This branch used to return
        // before the media upload further down, so photos added to an
        // already-played shared round were silently discarded — no error, no
        // upload, just gone. Routing them through the round's media endpoint
        // also means the round->post mirror carries them onto the feed card,
        // and that endpoint re-mirrors when the round is already 'completed'
        // (which every already-played round is).
        if (mediaFiles.length > 0) {
          const attached = await Promise.allSettled(
            mediaFiles.map(async file => {
              const { url, thumbnailUrl } = await uploadMediaWithPoster(file);
              const res = await fetch(`/api/group-posts/${groupPostId}/media`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                  media_url: url,
                  media_type: file.type === 'video' ? 'video' : 'image',
                  thumbnail_url: thumbnailUrl,
                }),
              });
              if (!res.ok) throw new Error('attach failed');
            })
          );
          if (attached.some(r => r.status === 'rejected')) {
            showError('Round posted, but some photos could not be attached.');
          }
        }

        if (!sharedRoundDetails.alreadyPlayed) {
          showSuccess(
            sharedRoundParticipants.length > 0
              ? 'Round is LIVE! Scores stream to your group as you play. 🔴'
              : 'Round is LIVE! 🔴'
          );
        } else {
          showSuccess('Round posted! Participants will be notified. 🎉');
        }

        // Parents still do their refresh work — the user comes back to that
        // page later, and an abandoned refetch is harmless.
        if (onPostCreated) {
          onPostCreated(groupPostResult.group_post);
        }

        closeAndReset();

        // Going live goes INTO the round. This decision lives HERE, at the one
        // point a round is created, rather than in a parent's onPostCreated —
        // which is why it previously worked on /feed and nowhere else: three
        // pages mount this composer and the app header funnels most routes to
        // /athlete, whose handler never got it. router.push does not care which
        // page mounted us, so all three are fixed and a fourth cannot drift.
        const scorerPath = shouldEnterScorerAfterCreate(groupPostResult.group_post);
        if (scorerPath) router.push(scorerPath);
        return;
      }

      // Upload media files (for individual posts)
      const uploadedMedia = await Promise.all(
        mediaFiles.map(async (file) => {
          const { url, thumbnailUrl } = await uploadMediaWithPoster(file);
          return { ...file, url, thumbnailUrl };
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
          thumbnailUrl: file.thumbnailUrl
        })),
        golfData: postType === 'golf' ? golfRoundData : undefined,
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
      showError('Failed to create post', 'Please try again');
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
  const isLiveSetup = postType === 'golf' && !sharedRoundDetails.alreadyPlayed;

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

          {/* Golf: timing first — "Playing now" IS the live path (solo or
              with friends); "Already played" keeps individual/shared batch */}
          {postType === 'golf' && (
            <div className="mb-6">
              <label className="block text-sm font-semibold text-secondary mb-3">When is this round?</label>
              {/* Stacks below sm — "Already played" + icon wraps in a ~90px
                  half-column at 320px (same pattern as the holes row below) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  onClick={() => {
                    roundTimingTouchedRef.current = true;
                    setSharedRoundDetails(prev => ({ ...prev, alreadyPlayed: false }));
                  }}
                  className={`px-4 py-3 rounded-lg font-semibold transition-all ${
                    !sharedRoundDetails.alreadyPlayed
                      ? 'bg-red-600 text-white'
                      : 'bg-surface text-secondary border-2 border-border-strong hover:border-red-300 dark:hover:border-red-700'
                  }`}
                >
                  <span className={`inline-block w-2 h-2 rounded-full mr-2 ${!sharedRoundDetails.alreadyPlayed ? 'bg-white animate-pulse' : 'bg-red-500'}`}></span>
                  Playing now
                </button>
                <button
                  onClick={() => {
                    roundTimingTouchedRef.current = true;
                    setSharedRoundDetails(prev => ({ ...prev, alreadyPlayed: true }));
                  }}
                  className={`px-4 py-3 rounded-lg font-semibold transition-all ${
                    sharedRoundDetails.alreadyPlayed
                      ? 'bg-gray-700 text-white'
                      : 'bg-surface text-secondary border-2 border-border-strong hover:border-gray-400'
                  }`}
                >
                  <i className="fas fa-flag-checkered mr-2"></i>
                  Already played
                </button>
              </div>
              <p className="mt-1.5 text-xs text-muted">
                {sharedRoundDetails.alreadyPlayed
                  ? 'Log a finished round — full scorecard, solo or with friends.'
                  : 'Round goes LIVE — score hole by hole as you play, solo or with friends.'}
              </p>
            </div>
          )}

          {/* Golf Round Type Selection (batch entry only — a live round is one
              flow where friends are optional) */}
          {postType === 'golf' && sharedRoundDetails.alreadyPlayed && (
            <div className="mb-6">
              <label className="block text-sm font-semibold text-secondary mb-3">Round Type</label>
              {/* Stacks below sm — the icon + two-line copy had ~36px of text
                  width in a 320px half-column */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <button
                  onClick={() => setRoundType('individual')}
                  className={`p-4 border-2 rounded-lg text-left transition-all ${
                    roundType === 'individual'
                      ? 'border-green-500 bg-green-50 dark:bg-green-950/40'
                      : 'border-border-strong hover:border-gray-400'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                      roundType === 'individual' ? 'bg-green-100 dark:bg-green-950/60' : 'bg-surface-sunken'
                    }`}>
                      <i className={`fas fa-user text-lg ${
                        roundType === 'individual' ? 'text-green-600 dark:text-green-400' : 'text-tertiary'
                      }`}></i>
                    </div>
                    <div>
                      <div className="font-semibold text-primary">Individual Round</div>
                      <div className="text-sm text-tertiary">Track your own scorecard</div>
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => setRoundType('shared')}
                  className={`p-4 border-2 rounded-lg text-left transition-all ${
                    roundType === 'shared'
                      ? 'border-green-500 bg-green-50 dark:bg-green-950/40'
                      : 'border-border-strong hover:border-gray-400'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                      roundType === 'shared' ? 'bg-green-100 dark:bg-green-950/60' : 'bg-surface-sunken'
                    }`}>
                      <i className={`fas fa-users text-lg ${
                        roundType === 'shared' ? 'text-green-600 dark:text-green-400' : 'text-tertiary'
                      }`}></i>
                    </div>
                    <div>
                      <div className="font-semibold text-primary">Shared Round</div>
                      <div className="text-sm text-tertiary">Play with friends</div>
                    </div>
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* Shared Round Details Form */}
          {postType === 'golf' && roundType === 'shared' && (
            <div className="mb-6 bg-green-50 dark:bg-green-950/40 rounded-lg p-4 sm:p-6">
              <div className="space-y-6">
                {/* Course Details - White Box */}
              <div className="bg-surface rounded-lg border border-border p-4">
                <h3 className="text-lg font-semibold text-primary mb-4 flex items-center">
                  <i className="fas fa-flag-checkered mr-2 text-green-600 dark:text-green-400"></i>
                  Course Details
                </h3>

                {/* Course Name with Search */}
                <div className="mb-4 relative">
                  <label className="block text-sm font-semibold text-primary mb-2">
                    Course Name *
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={sharedRoundDetails.courseName}
                      onChange={(e) => {
                        setSharedRoundDetails(prev => ({ ...prev, courseName: e.target.value }));
                        setCourseSearchQuery(e.target.value);
                        searchCourses(e.target.value);
                        setCourseSearchOpen(true);
                        // Clear selected course if user types manually
                        if (selectedCourse && e.target.value !== selectedCourse.name) {
                          setSelectedCourse(null);
                        }
                      }}
                      onFocus={() => {
                        setCourseSearchOpen(true);
                        if (courseSearchQuery.length >= 2) {
                          searchCourses(courseSearchQuery);
                        }
                      }}
                      placeholder="Search for a golf course..."
                      className="w-full px-4 py-2 border border-border-strong rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 pr-10"
                    />
                    {searchLoading && (
                      <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                        <div className="animate-spin h-5 w-5 border-2 border-green-500 border-t-transparent rounded-full"></div>
                      </div>
                    )}
                    {!searchLoading && sharedRoundDetails.courseName && (
                      <i className="fas fa-search absolute right-3 top-1/2 transform -translate-y-1/2 text-faint"></i>
                    )}
                  </div>

                  {/* Course Search Results Dropdown */}
                  {courseSearchOpen && availableCourses.length > 0 && (
                    <>
                      {/* Backdrop to close dropdown */}
                      <div
                        className="fixed inset-0 z-10"
                        onClick={() => {
                          setCourseSearchOpen(false);
                          setAvailableCourses([]);
                        }}
                      />
                      {/* Dropdown */}
                      <div className="absolute z-20 w-full mt-1 bg-surface-raised border border-border-strong rounded-lg shadow-lg max-h-60 overflow-y-auto overscroll-contain">
                        {availableCourses.map((course) => (
                          <button
                            key={course.id}
                            onClick={() => selectCourse(course)}
                            className="w-full px-4 py-3 text-left hover:bg-green-50 dark:hover:bg-green-950/40 transition-colors border-b border-border-subtle last:border-b-0"
                          >
                            <div className="font-semibold text-primary">{course.name}</div>
                            {course.city && course.state && (
                              <div className="text-sm text-tertiary">
                                {course.city}, {course.state}
                              </div>
                            )}
                            <div className="text-xs text-muted mt-1">
                              Par {course.totalPar} • {course.holes.length} holes
                            </div>
                          </button>
                        ))}
                      </div>
                    </>
                  )}

                  {/* Selected Course Badge */}
                  {selectedCourse && (
                    <div className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 bg-green-100 dark:bg-green-950/60 text-green-800 dark:text-green-200 rounded-full text-sm font-medium border border-green-300 dark:border-green-700">
                      <i className="fas fa-check-circle text-xs"></i>
                      {selectedCourse.name}
                      {selectedCourse.city && selectedCourse.state && ` (${selectedCourse.city}, ${selectedCourse.state})`}
                    </div>
                  )}

                  {/* Help text for manual entry */}
                  {!selectedCourse && sharedRoundDetails.courseName && (
                    <div className="mt-2 flex items-start gap-2 p-3 bg-brand-soft border border-violet-200 dark:border-violet-800 rounded-lg">
                      <i className="fas fa-info-circle text-brand-fg mt-0.5"></i>
                      <p className="text-xs text-violet-800 dark:text-violet-200">
                        <strong>Custom course detected.</strong> Since this course isn&apos;t in our database, you can manually enter par and yardage below (optional).
                      </p>
                    </div>
                  )}
                </div>

                {/* Date */}
                <div className="mb-4">
                  <label className="block text-sm font-semibold text-primary mb-2">
                    Date *
                  </label>
                  <input
                    type="date"
                    value={sharedRoundDetails.date}
                    onChange={(e) => {
                      const date = e.target.value;
                      setSharedRoundDetails(prev => ({
                        ...prev,
                        date,
                        // Past date → assume already played, unless the user
                        // explicitly chose a timing
                        ...(roundTimingTouchedRef.current
                          ? {}
                          : { alreadyPlayed: date < new Date().toISOString().split('T')[0] }),
                      }));
                    }}
                    className="w-full px-4 py-2 border border-border-strong rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  />
                </div>

                {/* Indoor/Outdoor Selection */}
                <div className="mb-4">
                  <label className="block text-sm font-semibold text-primary mb-2">
                    Round Type *
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => setSharedRoundDetails(prev => ({ ...prev, roundTypeIndoorOutdoor: 'outdoor' }))}
                      className={`px-4 py-3 rounded-lg font-semibold transition-all ${
                        sharedRoundDetails.roundTypeIndoorOutdoor === 'outdoor'
                          ? 'bg-green-600 text-white'
                          : 'bg-surface text-secondary border-2 border-border-strong hover:border-green-300 dark:hover:border-green-700'
                      }`}
                    >
                      <i className="fas fa-tree mr-2"></i>
                      Outdoor
                    </button>
                    <button
                      onClick={() => setSharedRoundDetails(prev => ({ ...prev, roundTypeIndoorOutdoor: 'indoor' }))}
                      className={`px-4 py-3 rounded-lg font-semibold transition-all ${
                        sharedRoundDetails.roundTypeIndoorOutdoor === 'indoor'
                          ? 'bg-brand text-white'
                          : 'bg-surface text-secondary border-2 border-border-strong hover:border-violet-300 dark:hover:border-violet-700'
                      }`}
                    >
                      <i className="fas fa-warehouse mr-2"></i>
                      Indoor
                    </button>
                  </div>
                </div>

                {/* Game Format */}
                <div className="mb-4">
                  <label className="block text-sm font-semibold text-primary mb-2">
                    Game Format
                  </label>
                  {/* Stacks on phones — three ~100px columns wrap the two-word
                      labels badly at 360px */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3">
                    {([
                      { value: 'stroke', label: 'Stroke Play', icon: 'fa-golf-ball' },
                      { value: 'stableford', label: 'Stableford', icon: 'fa-star' },
                      { value: 'match', label: 'Match Play', icon: 'fa-people-arrows' },
                    ] as const).map(({ value, label, icon }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setSharedRoundDetails(prev => ({ ...prev, gameFormat: value }))}
                        className={`px-3 py-3 rounded-lg font-semibold text-sm transition-all ${
                          sharedRoundDetails.gameFormat === value
                            ? 'bg-green-600 text-white'
                            : 'bg-surface text-secondary border-2 border-border-strong hover:border-green-300 dark:hover:border-green-700'
                        }`}
                      >
                        <i className={`fas ${icon} mr-1.5`}></i>
                        {label}
                      </button>
                    ))}
                  </div>
                  {sharedRoundDetails.gameFormat === 'stableford' && (
                    <p className="mt-2 text-xs text-tertiary">
                      Points per hole — eagle 4, birdie 3, par 2, bogey 1. Highest points wins.
                    </p>
                  )}
                  {sharedRoundDetails.gameFormat === 'match' && (
                    <p className="mt-2 text-xs text-tertiary">
                      Head-to-head holes won — best with exactly 2 players. Scores are still recorded per hole.
                    </p>
                  )}
                </div>

                {/* Tee Color (optional, outdoor only) */}
                {sharedRoundDetails.roundTypeIndoorOutdoor === 'outdoor' && (
                  <div className="mb-4">
                    <label className="block text-sm font-semibold text-primary mb-2">
                      Tee Color (optional)
                    </label>
                    <select
                      value={sharedRoundDetails.teeColor}
                      onChange={(e) => setSharedRoundDetails(prev => ({ ...prev, teeColor: e.target.value }))}
                      className="w-full px-4 py-2 border border-border-strong rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                    >
                      <option value="">Select tee color</option>
                      <option value="black">Black</option>
                      <option value="blue">Blue</option>
                      <option value="white">White</option>
                      <option value="red">Red</option>
                      <option value="gold">Gold</option>
                    </select>
                  </div>
                )}
              </div>

              {/* Manual Par & Yardage Entry - White Box (when course not in database) */}
              {!selectedCourse && sharedRoundDetails.courseName && (
                <div className="bg-surface rounded-lg border border-border p-4">
                  <h3 className="text-lg font-semibold text-primary mb-4 flex items-center">
                    <i className="fas fa-edit mr-2 text-brand-fg"></i>
                    Course Par & Yardage (Optional)
                  </h3>
                  <div className="p-4 bg-surface-muted border border-border-strong rounded-lg">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs text-tertiary">Optional - adds Par & Yardage to scorecard</span>
                    </div>

                    <div className="max-h-64 overflow-y-auto overscroll-contain">
                      <div className="grid grid-cols-1 gap-3">
                        {Array.from({ length: sharedRoundDetails.holesPlayed }, (_, i) => {
                          const holeNum = i + 1;
                          return (
                            <div key={holeNum} className="flex items-center gap-3 bg-surface p-3 rounded border border-border">
                              <span className="text-sm font-semibold text-secondary w-16">Hole {holeNum}</span>
                              <div className="flex-1 flex gap-3">
                                <div className="flex-1">
                                  <label className="block text-xs text-tertiary mb-1">Par</label>
                                  <select
                                    value={manualParEntry[i] || ''}
                                    onChange={(e) => {
                                      const newPar = [...manualParEntry];
                                      newPar[i] = parseInt(e.target.value) || 0;
                                      setManualParEntry(newPar);
                                    }}
                                    className="w-full px-3 py-1.5 text-sm border border-border-strong rounded focus:ring-2 focus:ring-green-500 focus:border-green-500"
                                  >
                                    <option value="">-</option>
                                    <option value="3">3</option>
                                    <option value="4">4</option>
                                    <option value="5">5</option>
                                    <option value="6">6</option>
                                  </select>
                                </div>
                                <div className="flex-1">
                                  <label className="block text-xs text-tertiary mb-1">Yardage</label>
                                  <input
                                    type="number"
                                    value={manualYardageEntry[i] || ''}
                                    onChange={(e) => {
                                      const newYardage = [...manualYardageEntry];
                                      newYardage[i] = parseInt(e.target.value) || 0;
                                      setManualYardageEntry(newYardage);
                                    }}
                                    placeholder="yards"
                                    min="50"
                                    max="700"
                                    className="w-full px-3 py-1.5 text-sm border border-border-strong rounded focus:ring-2 focus:ring-green-500 focus:border-green-500"
                                  />
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="mt-3 text-xs text-tertiary">
                      <i className="fas fa-info-circle mr-1"></i>
                      Entering par and yardage will display these values in the scorecard
                    </div>
                  </div>
                </div>
              )}

              {/* Playing Conditions - White Box (outdoor only, required) */}
              {sharedRoundDetails.roundTypeIndoorOutdoor === 'outdoor' && (
                <div className="bg-surface rounded-lg border border-border p-4">
                  <h3 className="text-lg font-semibold text-primary mb-4 flex items-center">
                    <i className="fas fa-cloud-sun mr-2 text-violet-500"></i>
                    Playing Conditions
                  </h3>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                      {/* Weather */}
                      <div>
                        <label className="block text-xs font-semibold text-secondary mb-1.5">
                          Weather *
                        </label>
                        <select
                          value={sharedRoundDetails.weather}
                          onChange={(e) => setSharedRoundDetails(prev => ({ ...prev, weather: e.target.value }))}
                          className="w-full px-3 py-2 text-sm border border-border-strong rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
                          required
                        >
                          <option value="">Select weather</option>
                          <option value="sunny">☀️ Sunny</option>
                          <option value="partly-cloudy">⛅ Partly Cloudy</option>
                          <option value="cloudy">☁️ Cloudy</option>
                          <option value="rainy">🌧️ Rainy</option>
                          <option value="windy">💨 Windy</option>
                        </select>
                      </div>

                      {/* Temperature */}
                      <div>
                        <label className="block text-xs font-semibold text-secondary mb-1.5">
                          Temperature (°F) *
                        </label>
                        <input
                          type="number"
                          value={sharedRoundDetails.temperature}
                          onChange={(e) => setSharedRoundDetails(prev => ({ ...prev, temperature: e.target.value }))}
                          className="w-full px-3 py-2 text-sm border border-border-strong rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
                          placeholder="72"
                          min="0"
                          max="120"
                          required
                        />
                      </div>

                      {/* Wind */}
                      <div>
                        <label className="block text-xs font-semibold text-secondary mb-1.5">
                          Wind *
                        </label>
                        <select
                          value={sharedRoundDetails.wind}
                          onChange={(e) => setSharedRoundDetails(prev => ({ ...prev, wind: e.target.value }))}
                          className="w-full px-3 py-2 text-sm border border-border-strong rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
                          required
                        >
                          <option value="">Select wind</option>
                          <option value="calm">Calm (0-5 mph)</option>
                          <option value="light">Light (5-10 mph)</option>
                          <option value="moderate">Moderate (10-20 mph)</option>
                          <option value="strong">Strong (20+ mph)</option>
                        </select>
                      </div>
                    </div>
                </div>
              )}

              {/* Participants - White Box */}
              <div className="bg-surface rounded-lg border border-border p-4">
                <h3 className="text-lg font-semibold text-primary mb-4 flex items-center">
                  <i className="fas fa-users mr-2 text-green-600 dark:text-green-400"></i>
                  {sharedRoundDetails.alreadyPlayed ? 'Round Participants' : 'Playing partners'}
                </h3>
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-sm font-semibold text-primary">
                      {sharedRoundDetails.alreadyPlayed
                        ? `Participants * (${sharedRoundParticipants.length})`
                        : `Playing with anyone? Optional (${sharedRoundParticipants.length})`}
                    </label>
                    <div className="flex items-center gap-2">
                      {/* Only meaningful for an already-played round, where it
                          adds you to the in-composer score grid. On a live
                          round the server inserts the creator regardless, so
                          the button did nothing except imply partners are
                          expected. */}
                      {sharedRoundDetails.alreadyPlayed && (
                      <button
                        onClick={async () => {
                          // Check if user already added
                          if (sharedRoundParticipants.includes(userId)) {
                            return;
                          }

                          // Fetch current user's profile
                          try {
                            const response = await fetch(`/api/profile?id=${userId}`);
                            if (response.ok) {
                              const { profile } = await response.json();
                              const userName = profile.first_name && profile.last_name
                                ? `${profile.first_name} ${profile.last_name}`
                                : profile.full_name || 'Me';

                              // Add to participants - useEffect will handle score initialization
                              setSharedRoundParticipants(prev => [...prev, userId]);
                              setSharedRoundParticipantsData(prev => [...prev, { id: userId, name: userName, avatar_url: profile.avatar_url }]);
                            } else {
                              const errorData = await response.json();
                              console.error('Failed to add yourself to round:', errorData.error);
                              showError('Failed to add yourself to the round. Please try again.');
                            }
                          } catch (error) {
                            console.error('Error adding yourself to round:', error);
                            showError('Failed to add yourself to the round. Please try again.');
                          }
                        }}
                        disabled={sharedRoundParticipants.includes(userId)}
                        className={`flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg transition-colors font-semibold ${
                          sharedRoundParticipants.includes(userId)
                            ? 'bg-green-100 dark:bg-green-950/60 text-green-700 dark:text-green-300 cursor-not-allowed'
                            : 'text-brand-fg-strong hover:text-violet-800 dark:hover:text-violet-200 hover:bg-violet-100 dark:hover:bg-violet-950/60'
                        }`}
                      >
                        {sharedRoundParticipants.includes(userId) ? (
                          <>
                            <i className="fas fa-check"></i>
                            You&apos;re included
                          </>
                        ) : (
                          <>
                            <i className="fas fa-user-plus"></i>
                            + Add Myself
                          </>
                        )}
                      </button>
                      )}
                      <button
                        onClick={() => setShowParticipantModal(true)}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm text-green-700 dark:text-green-300 hover:text-green-800 dark:hover:text-green-200 hover:bg-green-100 dark:hover:bg-green-950/60 rounded-lg transition-colors font-semibold"
                      >
                        <i className="fas fa-users"></i>
                        Add Others
                      </button>
                    </div>
                  </div>

                  {/* Participant chips */}
                  {sharedRoundParticipantsData.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {sharedRoundParticipantsData.map(participant => (
                        <span
                          key={participant.id}
                          className="inline-flex items-center gap-2 px-3 py-1.5 bg-green-100 dark:bg-green-950/60 text-green-800 dark:text-green-200 rounded-full text-sm font-medium border border-green-300 dark:border-green-700"
                        >
                          <i className="fas fa-user text-xs"></i>
                          {participant.name}
                          <button
                            onClick={() => removeParticipant(participant.id)}
                            className="ml-1 hover:text-green-900 dark:hover:text-green-200 min-w-[32px] min-h-[32px] -my-1.5 -mr-2 flex items-center justify-center rounded-full hover:bg-green-200"
                            aria-label={`Remove ${participant.name}`}
                          >
                            <i className="fas fa-times text-xs"></i>
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : sharedRoundDetails.alreadyPlayed ? (
                    <div className="text-sm text-tertiary bg-surface rounded-lg p-3 border border-border-strong">
                      <i className="fas fa-info-circle mr-1"></i>
                      Add at least one participant to create a shared round
                    </div>
                  ) : (
                    // Live rounds are solo by default — nothing here is
                    // required. The old copy said a participant was needed and
                    // read as a hard block even though Go Live was enabled.
                    <div className="text-sm text-tertiary bg-surface rounded-lg p-3 border border-border-strong">
                      <i className="fas fa-golf-ball-tee mr-1"></i>
                      Playing solo — just hit Go Live. Add partners any time if
                      someone joins you.
                    </div>
                  )}
                </div>
              </div>
              </div>
            </div>
          )}

          {/* Score Entry Section (when shared round with participants) */}
          {postType === 'golf' && roundType === 'shared' && sharedRoundParticipantsData.length > 0 && (
            <div className="mb-6">
              <div className="bg-surface rounded-lg border border-border p-4">
                <h3 className="text-lg font-semibold text-primary mb-4 flex items-center">
                  <i className="fas fa-list-ol mr-2 text-green-600 dark:text-green-400"></i>
                  Score Entry
                </h3>
                <p className="text-sm text-tertiary mb-4">
                  Enter scores below or leave blank - participants can add them later
                </p>

                {/* Multi-player scorecard grid - always shown */}
                <div>
                  <MultiPlayerScorecardGrid
                      players={playerScores}
                      holes={sharedRoundDetails.holesPlayed}
                      editable={true}
                      showDetailedStats={false}
                      onScoreChange={handlePlayerScoreChange}
                      holeData={
                        // Use course data if available, otherwise manual entry
                        courseHoleData.length > 0
                          ? courseHoleData
                          : manualParEntry.length > 0 || manualYardageEntry.length > 0
                          ? Array.from({ length: sharedRoundDetails.holesPlayed }, (_, i) => ({
                              hole: i + 1,
                              par: manualParEntry[i] || 4,
                              yardage: manualYardageEntry[i] || undefined
                            }))
                          : undefined
                      }
                    />
                </div>
              </div>
            </div>
          )}

          {/* Golf Scorecard (when individual round is selected) */}
          {postType === 'golf' && roundType === 'individual' && (
            <div className="mb-6">
              <div className="bg-green-50 dark:bg-green-950/40 rounded-lg border border-green-200 dark:border-green-800 p-4">
                <GolfScorecardForm
                  onDataChange={(data) => setGolfRoundData(data)}
                />
              </div>

              {/* Generate Caption from Stats */}
              {golfRoundData && (
                <button
                  onClick={() => setCaption(generateGolfCaption())}
                  className="mt-3 text-sm text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 font-medium"
                >
                  <i className="fas fa-magic mr-1"></i>
                  Generate caption from scorecard
                </button>
              )}
            </div>
          )}

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

          {/* Media Upload */}
          <div className={isLiveSetup ? 'hidden' : 'mb-6'}>
            <label className="block text-sm font-semibold text-secondary mb-3">
              Media ({mediaFiles.length}/{MAX_MEDIA_FILES})
            </label>

            {/* Upload area */}
            <div
              className={`border-2 border-dashed rounded-lg p-6 text-center transition-all ${
                draggedOver
                  ? 'border-violet-500 bg-brand-soft'
                  : 'border-border-strong hover:border-gray-400'
              }`}
              onDrop={(e) => {
                e.preventDefault();
                setDraggedOver(false);
                if (e.dataTransfer.files) {
                  handleFileUpload(e.dataTransfer.files);
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDraggedOver(true);
              }}
              onDragLeave={() => setDraggedOver(false)}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,video/*"
                className="hidden"
                onChange={(e) => e.target.files && handleFileUpload(e.target.files)}
              />

              <i className="fas fa-cloud-upload-alt text-4xl text-faint mb-3"></i>
              <p className="text-tertiary mb-2">
                Drag and drop files here, or{' '}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="text-brand-fg hover:text-brand-fg-strong font-medium"
                >
                  browse
                </button>
              </p>
              <p className="text-xs text-muted">
                Images and videos up to 50MB each — crop, adjust, and filter before posting
              </p>
            </div>

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

                    {/* Edit (re-opens the editor rehydrated with this asset's recipe) */}
                    {file.type === 'image' && (file.sourceFile || file.file) && (
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
                {postType === 'golf' && roundType === 'shared'
                  ? (() => {
                      // Name the ACTUAL missing fields — a dead grey button
                      // with a stale generic hint reads as "broken"
                      const missing: string[] = [];
                      if (!sharedRoundDetails.courseName.trim()) missing.push('course name');
                      if (!sharedRoundDetails.date) missing.push('date');
                      if (sharedRoundDetails.alreadyPlayed && sharedRoundParticipants.length === 0) {
                        missing.push('at least one participant');
                      }
                      return missing.length > 0
                        ? `Missing: ${missing.join(', ')}`
                        : 'Please complete the round details';
                    })()
                  : postType === 'golf'
                  ? 'Please complete the scorecard'
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
          holeParSource={courseHoleData.length > 0
            ? courseHoleData
            : manualParEntry.map((par, idx) => ({ hole: idx + 1, par })).filter(h => h.par > 0)}
          postType={postType}
          caption={caption}
          tags={selectedTags}
          hashtags={hashtags}
          mediaFiles={mediaFiles}
          visibility={visibility}
          golfData={golfRoundData}
          taggedPeople={taggedProfilesData}
          roundType={roundType}
          sharedRoundDetails={sharedRoundDetails}
          sharedRoundParticipants={sharedRoundParticipantsData}
          playerScores={playerScores}
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

      {/* Participant Selection Modal (for shared rounds) */}
      <TagPeopleModal
        isOpen={showParticipantModal}
        onClose={() => setShowParticipantModal(false)}
        existingTags={sharedRoundParticipants}
        onSelectionComplete={handleParticipantSelection}
        selectionMode={true}
      />

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
  golfData,
  taggedPeople = [],
  roundType,
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

              {/* Golf Scorecard Summary */}
              {postType === 'golf' && (
                <div className="mb-4 p-4 bg-green-50 dark:bg-green-950/40 rounded-lg border border-green-200 dark:border-green-800">
                  <div className="flex items-center gap-2 mb-2">
                    <i className="fas fa-golf-ball text-green-600 dark:text-green-400"></i>
                    <span className="font-semibold text-green-800 dark:text-green-200">
                      {roundType === 'shared' ? 'Shared Golf Round' : 'Golf Round'}
                    </span>
                  </div>
                  <div className="text-sm text-green-700 dark:text-green-300 space-y-1">
                    {/* Individual Round */}
                    {roundType === 'individual' && golfData && (
                      <>
                        {golfData.courseName && <div><strong>Course:</strong> {golfData.courseName}</div>}
                        {golfData.holesData && (() => {
                          const scored = golfData.holesData.filter((h: HoleData) => h.score !== undefined);
                          if (scored.length === 0) return null;
                          const total = scored.reduce((sum: number, h: HoleData) => sum + (h.score || 0), 0);
                          const par = scored.reduce((sum: number, h: HoleData) => sum + h.par, 0);
                          return (
                            <>
                              <div><strong>Score:</strong> {total} ({total - par >= 0 ? '+' : ''}{total - par})</div>
                              <div><strong>Holes Played:</strong> {scored.length}</div>
                            </>
                          );
                        })()}
                      </>
                    )}

                    {/* Shared Round - Use SharedRoundQuickView Component */}
                    {roundType === 'shared' && sharedRoundDetails && (
                      <div className="relative">
                        <SharedRoundQuickView
                          scorecard={transformToScorecardPreview(
                            sharedRoundDetails,
                            sharedRoundParticipants,
                            playerScores,
                            userId,
                            holeParSource
                          )}
                          onExpand={() => {
                            // In preview mode, we can just show a message or do nothing
                            // The full scorecard modal would require more state management
                            // For now, the button will be visible but won't do anything special in preview
                          }}
                          currentUserId={userId}
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Media */}
              {mediaFiles.length > 0 && (
                <div className={`grid ${mediaFiles.length === 1 ? 'grid-cols-1' : 'grid-cols-2'} gap-2 rounded-lg overflow-hidden`}>
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