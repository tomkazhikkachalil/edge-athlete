'use client';

// ── Golf's slice of the post composer ─────────────────────────────────────────
// Extracted wholesale from CreatePostModal (sport-cleanup D-2): every piece of
// golf-only composer state (round timing, shared-round details, course search,
// manual par/yardage, participants, score entry, the individual scorecard)
// lives HERE, and the modal keeps exactly one sport slot (see
// src/components/sport-composer-extras.ts). The section reports its full value
// up via `onChange` on every internal change; CreatePostModal stores that
// snapshot and reads it in submit, validation, the footer hint and the preview.
//
// The section stays MOUNTED while the composer is open even when another sport
// is selected (`active` false) — the old inline state outlived the postType
// toggle, so switching golf → general → golf must keep the scorecard.

import { useState, useCallback, useRef, useEffect } from 'react';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/lib/auth';
import { hasAnyEnteredScore } from '@/lib/golf/score-entry';
import { useDebouncedCallback } from '@/hooks/useDebouncedCallback';
import { usePopoverDismiss } from '@/hooks/usePopoverDismiss';
import GolfScorecardForm from '@/components/golf/GolfScorecardForm';
import TagPeopleModal from '@/components/TagPeopleModal';
import MultiPlayerScorecardGrid, { type PlayerScoreData, type PlayerHoleScore } from '@/components/golf/MultiPlayerScorecardGrid';
import type { HoleData, GolfCourse } from '@/types/golf';
import type { SportComposerExtraProps } from '@/components/sport-composer-extras';
import { GOLF_INPUT, GOLF_INPUT_COMPACT, GOLF_SELECT, GOLF_LABEL, GOLF_SECTION_CARD } from '@/components/golf/golf-form-styles';

export interface GolfRoundData {
  courseName?: string;
  holesData?: HoleData[];
}

/** Full shared-round form state. CreatePostModal's preview only reads the
 *  display fields, but gameFormat/alreadyPlayed drive submission and the
 *  live-vs-batch flow, so the whole object travels in the value. */
export interface GolfSharedRoundDetails {
  courseName: string;
  date: string;
  holesPlayed: number;
  roundTypeIndoorOutdoor: 'outdoor' | 'indoor';
  gameFormat: 'stroke' | 'stableford' | 'match';
  teeColor: string;
  weather: string;
  temperature: string;
  wind: string;
  /** "Already played" rounds post as FINAL immediately (no LIVE badge, no
   *  resume banner) — for logging rounds after the fact */
  alreadyPlayed: boolean;
}

/** Everything CreatePostModal's submit paths, validation, footer hint and
 *  preview read — the section's one-way report up. */
export interface GolfComposerValue {
  golfRoundData: GolfRoundData | null;
  roundType: 'individual' | 'shared';
  sharedRoundDetails: GolfSharedRoundDetails;
  sharedRoundParticipants: string[];
  sharedRoundParticipantsData: { id: string; name: string; avatar_url?: string }[];
  playerScores: PlayerScoreData[];
  courseHoleData: { hole: number; par: number; yardage?: number }[];
  manualParEntry: number[];
  manualYardageEntry: number[];
  /** Real per-hole pars for the preview: course search first, manual entry
   *  second — the same derivation CreatePostModal inlined before extraction. */
  holeParSource: { hole: number; par: number }[];
  /** The golf branch of the composer's submit gate. */
  isValid: boolean;
  /** Golf's share of the composer's unsaved-work check. */
  isDirty: boolean;
}

/** What the parent holds before the section's first report (and after reset).
 *  Mirrors the section's initial state as observed from outside — including
 *  the render-time pin of a live round to 'shared'. */
export function defaultGolfComposerValue(): GolfComposerValue {
  return {
    golfRoundData: null,
    roundType: 'shared',
    sharedRoundDetails: {
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
    },
    sharedRoundParticipants: [],
    sharedRoundParticipantsData: [],
    playerScores: [],
    courseHoleData: [],
    manualParEntry: [],
    manualYardageEntry: [],
    holeParSource: [],
    isValid: false,
    isDirty: false,
  };
}

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

export default function GolfComposerSection({
  userId,
  active,
  onChange,
  onCaptionGenerated,
}: SportComposerExtraProps) {
  const { showError } = useToast();
  // activeProfile first, so a guardian composing AS a managed athlete seeds
  // that athlete's row rather than their own (GolfScorecardForm does the same).
  const { profile, activeProfile } = useAuth();
  const displayProfile = activeProfile ?? profile;

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
  // (`active` ⇔ the composer's postType is 'golf', as before extraction.)
  if (active && !sharedRoundDetails.alreadyPlayed && roundType !== 'shared') {
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

  // Search for golf courses (for shared rounds). Debounced + abortable: it is
  // called straight out of the input's onChange, so undebounced it fired one
  // request per keystroke. Suggestions start at 1 character.
  const runCourseSearch = useCallback(async (signal: AbortSignal, query: string) => {
    setSearchLoading(true);
    try {
      const response = await fetch(
        `/api/golf/courses?q=${encodeURIComponent(query)}&limit=8`,
        { signal }
      );
      if (response.ok) {
        const data = await response.json();
        setAvailableCourses(data.courses || []);
      } else {
        console.error('Failed to search golf courses — status:', response.status);
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      console.error('Failed to search golf courses:', e);
      setAvailableCourses([]);
    } finally {
      if (!signal.aborted) setSearchLoading(false);
    }
  }, []);

  const [debouncedCourseSearch, cancelCourseSearch] = useDebouncedCallback(runCourseSearch);

  const searchCourses = useCallback((query: string) => {
    if (query.trim().length < 1) {
      // CANCEL, don't just return: an armed timer would still fire and refill
      // the list the user just cleared — and with it the dropdown.
      cancelCourseSearch();
      setAvailableCourses([]);
      return;
    }
    debouncedCourseSearch(query.trim());
  }, [debouncedCourseSearch, cancelCourseSearch]);

  // Outside press + Escape, instead of a viewport-covering backdrop div.
  const courseFieldRef = useRef<HTMLDivElement>(null);
  const courseDropdownRef = useRef<HTMLDivElement>(null);
  const closeCourseSearch = useCallback(() => {
    setCourseSearchOpen(false);
    setAvailableCourses([]);
  }, []);
  const courseDropdownOpen = courseSearchOpen && availableCourses.length > 0;
  usePopoverDismiss(courseFieldRef, courseDropdownOpen, closeCourseSearch);

  // The dropdown is `absolute` inside the composer's `overflow-y-auto` body, so
  // it is CLIPPED at that ancestor's edge — measured at 240px tall hanging out
  // of a scroller that ended 138px earlier, i.e. most of the list was
  // invisible and unclickable. Nudge it into view, the same fix
  // AddEquipmentModal.tsx already uses for its brand/model panels (which is
  // why those measure clean). No-op when the list is already fully visible.
  useEffect(() => {
    if (!courseDropdownOpen) return;
    // rAF: the panel must be laid out before it can be measured.
    const id = requestAnimationFrame(() =>
      courseDropdownRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    );
    return () => cancelAnimationFrame(id);
  }, [courseDropdownOpen, availableCourses.length]);

  // Select a course from search results (for shared rounds)
  const selectCourse = useCallback((course: GolfCourse) => {
    setSelectedCourse(course);
    setSharedRoundDetails(prev => ({
      ...prev,
      courseName: course.name
    }));
    setCourseSearchOpen(false);
    setCourseSearchQuery('');
    // Cancel first: a response already in flight would otherwise land after
    // this and refill the list, re-opening the dropdown over a chosen course.
    cancelCourseSearch();
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
  }, [sharedRoundDetails.teeColor, sharedRoundDetails.holesPlayed, cancelCourseSearch]);

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

  // ── The creator's own row ───────────────────────────────────────────────────
  // Score Entry used to be gated on having PLAYING PARTNERS, so on the default
  // "Playing now" path — where you are the only player — it never appeared at
  // all, and you could not enter your own scores while composing. The creator
  // is a first-class participant everywhere else (the server inserts them with
  // role:'creator', the live round renders them as an ordinary player), so seed
  // their row here and let the grid render from the moment golf is selected.
  //
  // playerScores ONLY — deliberately not sharedRoundParticipants(Data). Those
  // two drive the Playing Partners chips and the submitted participant_ids;
  // leaving them alone keeps that section unchanged and keeps the payload
  // identical, because /api/group-posts already prepends the creator when the
  // array omits them (so `position` stays 0).
  //
  // Render-phase, not an effect: this is state SYNCHRONISATION (the same idiom
  // as the roundType pin above), and the guard is self-clearing — once the row
  // exists the condition is false.
  const creatorName = displayProfile
    ? (displayProfile.first_name && displayProfile.last_name
        ? `${displayProfile.first_name} ${displayProfile.last_name}`
        : displayProfile.full_name || 'You')
    : null;

  if (
    active &&
    roundType === 'shared' &&
    userId &&
    creatorName &&
    !playerScores.some(p => p.participant_id === userId)
  ) {
    initializePlayerScores(
      [{ id: userId, name: creatorName, avatar_url: displayProfile?.avatar_url ?? undefined }],
      sharedRoundDetails.holesPlayed
    );
  }

  // NB: sharedRoundDetails.holesPlayed is a constant 18 on the shared path —
  // nothing in this component ever sets it (the 9/18 control belongs to the
  // INDIVIDUAL form). So every row is built with 18 slots and none ever needs
  // resizing. If a hole-count control is ever added here, note that
  // initializePlayerScores does NOT resize existing rows and
  // handlePlayerScoreChange only maps over slots that already exist, so rows
  // would have to be extended when the count grows.

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
        // Normalise null -> undefined at this boundary: the search API returns
        // explicit nulls, while the participant state downstream is optional.
        return { id: profile.id, name, avatar_url: profile.avatar_url ?? undefined };
      });

      // Merge new profiles with existing participant data (don't replace)
      setSharedRoundParticipantsData(prev => {
        const existingIds = new Set(prev.map(p => p.id));
        const newProfiles = profilesData.filter(p => !existingIds.has(p.id));
        return [...prev, ...newProfiles];
      });

      // Initialize score rows for the new players right here, at the point
      // they are added (handler-based — the old "sync via useEffect" version
      // was CreatePostModal's one set-state-in-effect warning; see
      // eslint.config.mjs). initializePlayerScores skips ids that already
      // have rows, so re-selecting existing players is a no-op — and a later
      // holesPlayed change never resized existing rows under the effect
      // version either (it only ever added NEW players).
      initializePlayerScores(profilesData, sharedRoundDetails.holesPlayed);
    }
  };

  // Remove participant
  const removeParticipant = (profileId: string) => {
    setSharedRoundParticipants(prev => prev.filter(id => id !== profileId));
    setSharedRoundParticipantsData(prev => prev.filter(p => p.id !== profileId));
    // Also remove from scores
    setPlayerScores(prev => prev.filter(p => p.participant_id !== profileId));
  };

  // Generate golf caption from stats
  const generateGolfCaption = () => {
    if (!golfRoundData || !active) return '';

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

  // Report the full golf value up on every internal change. One-way flow:
  // the parent never pushes golf state back down, so this effect only
  // synchronizes React state OUT to the owner (via a prop callback — no
  // setState of this component's own happens here).
  useEffect(() => {
    // Validation — moved verbatim from CreatePostModal's isValidForSubmission
    // golf branch (Boolean() added: the individual-round expression used to
    // return the courseName string, and the parent only ever truth-tests it).
    const isValid =
      roundType === 'individual'
        ? // Individual rounds need scorecard data
          Boolean(golfRoundData && golfRoundData.courseName && golfRoundData.holesData?.some((h: HoleData) => h.score !== undefined))
        : // Shared rounds need at least course name, date, and at least one participant
          // Weather fields are optional - can be added later or left blank
          // Course + date only. Playing partners are NOT required: you are
          // always on the scorecard yourself, so a solo round is a complete
          // round whether it is live or already played. (This used to demand a
          // participant for already-played rounds, which is why the old "+ Add
          // Myself" button existed.)
          Boolean(
            sharedRoundDetails.courseName.trim().length > 0 &&
            sharedRoundDetails.date
          );

    // Golf's share of the composer's unsaved-work check.
    // NOT roundType: a live golf round pins it to 'shared' during render
    // (solo is a shared round with zero invitees), so counting it here made
    // the composer dirty the instant it opened and every close prompted to
    // discard work the user had not started. The fields below are the real
    // signal that something was entered.
    const isDirty =
      golfRoundData !== null ||
      sharedRoundParticipants.length > 0 ||
      selectedCourse !== null ||
      sharedRoundDetails.courseName.trim() !== '' ||
      manualParEntry.length > 0 ||
      manualYardageEntry.length > 0 ||
      // A seeded row is not work. Counting playerScores.length here would make
      // the composer dirty the instant golf is selected, so every close would
      // prompt to discard work nobody started — the same bug the roundType note
      // above records. Only an actual stroke counts.
      hasAnyEnteredScore(playerScores);

    onChange({
      golfRoundData,
      roundType,
      sharedRoundDetails,
      sharedRoundParticipants,
      sharedRoundParticipantsData,
      playerScores,
      courseHoleData,
      manualParEntry,
      manualYardageEntry,
      holeParSource: courseHoleData.length > 0
        ? courseHoleData
        : manualParEntry.map((par, idx) => ({ hole: idx + 1, par })).filter(h => h.par > 0),
      isValid,
      isDirty,
    });
  }, [
    onChange,
    golfRoundData,
    roundType,
    sharedRoundDetails,
    sharedRoundParticipants,
    sharedRoundParticipantsData,
    playerScores,
    courseHoleData,
    manualParEntry,
    manualYardageEntry,
    selectedCourse,
  ]);

  return (
    <>
      {active && (
        <>
          {/* Golf: timing first — "Playing now" IS the live path (solo or
              with friends); "Already played" keeps individual/shared batch */}
          <div className="mb-6">
            <label className={GOLF_LABEL}>When is this round?</label>
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
                    ? 'bg-brand text-white'
                    : 'bg-surface text-secondary border-2 border-border-strong hover:border-border-strong'
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

          {/* Golf Round Type Selection (batch entry only — a live round is one
              flow where friends are optional) */}
          {sharedRoundDetails.alreadyPlayed && (
            <div className="mb-6">
              <label className={GOLF_LABEL}>Round Type</label>
              {/* Stacks below sm — the icon + two-line copy had ~36px of text
                  width in a 320px half-column */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <button
                  onClick={() => setRoundType('individual')}
                  className={`p-4 border-2 rounded-lg text-left transition-all ${
                    roundType === 'individual'
                      ? 'border-green-500 bg-green-50 dark:bg-green-950/40'
                      : 'border-border-strong hover:border-border-strong'
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
                      : 'border-border-strong hover:border-border-strong'
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
          {roundType === 'shared' && (
            <div className="mb-6 bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800 rounded-lg p-4 sm:p-6">
              <div className="space-y-6">
                {/* Course Details - White Box */}
              <div className={GOLF_SECTION_CARD}>
                <h3 className="text-lg font-semibold text-primary mb-4 flex items-center">
                  <i className="fas fa-flag-checkered mr-2 text-green-600 dark:text-green-400"></i>
                  Course Details
                </h3>

                {/* Course Name with Search. The ref bounds "inside" for
                    usePopoverDismiss — a press anywhere else closes the
                    dropdown, and unlike the backdrop it used to render, that
                    press still reaches whatever it landed on. */}
                <div ref={courseFieldRef} className="mb-4 relative">
                  <label className={GOLF_LABEL}>
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
                        if (courseSearchQuery.trim().length >= 1) {
                          searchCourses(courseSearchQuery);
                        }
                      }}
                      onKeyDown={(e) => {
                        // Escape closes the DROPDOWN first and stops there —
                        // the composer's own Escape would otherwise discard
                        // the whole post. Innermost layer closes first, the
                        // same rule the message action sheet follows.
                        if (e.key === 'Escape' && courseDropdownOpen) {
                          e.preventDefault();
                          e.stopPropagation();
                          closeCourseSearch();
                        }
                      }}
                      placeholder="Search for a golf course..."
                      className={`${GOLF_INPUT} pr-10`}
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

                  {/* Course Search Results Dropdown.
                      There used to be a `fixed inset-0 z-10` click-catcher
                      here. It FROZE the composer: being `position: fixed` it
                      covered the whole viewport above the modal body, and a
                      scroll gesture landing on it chained to the document —
                      which useBodyScrollLock has set to overflow:hidden. So
                      nothing moved, and every tap elsewhere in the modal was
                      swallowed. Dismissal is now usePopoverDismiss (outside
                      press + Escape), which is the house pattern precisely
                      because invisible backdrops do this. */}
                  {courseDropdownOpen && (
                    <div
                      ref={courseDropdownRef}
                      className="absolute z-20 w-full mt-1 bg-surface-raised border border-border-strong rounded-lg shadow-lg max-h-60 overflow-y-auto overscroll-contain"
                    >
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
                  <label className={GOLF_LABEL}>
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
                    className={GOLF_INPUT}
                  />
                </div>

                {/* Indoor/Outdoor Selection */}
                <div className="mb-4">
                  <label className={GOLF_LABEL}>
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
                  <label className={GOLF_LABEL}>
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
                    <label className={GOLF_LABEL}>
                      Tee Color (optional)
                    </label>
                    <select
                      value={sharedRoundDetails.teeColor}
                      onChange={(e) => setSharedRoundDetails(prev => ({ ...prev, teeColor: e.target.value }))}
                      className={GOLF_SELECT}
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
                <div className={GOLF_SECTION_CARD}>
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
                                  <label className={GOLF_LABEL}>Par</label>
                                  <select
                                    value={manualParEntry[i] || ''}
                                    onChange={(e) => {
                                      const newPar = [...manualParEntry];
                                      newPar[i] = parseInt(e.target.value) || 0;
                                      setManualParEntry(newPar);
                                    }}
                                    className={GOLF_INPUT_COMPACT}
                                  >
                                    <option value="">-</option>
                                    <option value="3">3</option>
                                    <option value="4">4</option>
                                    <option value="5">5</option>
                                    <option value="6">6</option>
                                  </select>
                                </div>
                                <div className="flex-1">
                                  <label className={GOLF_LABEL}>Yardage</label>
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
                                    className={GOLF_INPUT_COMPACT}
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
                <div className={GOLF_SECTION_CARD}>
                  <h3 className="text-lg font-semibold text-primary mb-4 flex items-center">
                    <i className="fas fa-cloud-sun mr-2 text-violet-500"></i>
                    Playing Conditions
                  </h3>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                      {/* Weather */}
                      <div>
                        <label className={GOLF_LABEL}>
                          Weather *
                        </label>
                        <select
                          value={sharedRoundDetails.weather}
                          onChange={(e) => setSharedRoundDetails(prev => ({ ...prev, weather: e.target.value }))}
                          className={GOLF_SELECT}
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
                        <label className={GOLF_LABEL}>
                          Temperature (°F) *
                        </label>
                        <input
                          type="number"
                          value={sharedRoundDetails.temperature}
                          onChange={(e) => setSharedRoundDetails(prev => ({ ...prev, temperature: e.target.value }))}
                          className={GOLF_INPUT}
                          placeholder="72"
                          min="0"
                          max="120"
                          required
                        />
                      </div>

                      {/* Wind */}
                      <div>
                        <label className={GOLF_LABEL}>
                          Wind *
                        </label>
                        <select
                          value={sharedRoundDetails.wind}
                          onChange={(e) => setSharedRoundDetails(prev => ({ ...prev, wind: e.target.value }))}
                          className={GOLF_SELECT}
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
              <div className={GOLF_SECTION_CARD}>
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

                              // Add to participants — score rows are
                              // initialized right here (handler-based; see
                              // handleParticipantSelection's note)
                              setSharedRoundParticipants(prev => [...prev, userId]);
                              setSharedRoundParticipantsData(prev => [...prev, { id: userId, name: userName, avatar_url: profile.avatar_url }]);
                              initializePlayerScores([{ id: userId, name: userName, avatar_url: profile.avatar_url }], sharedRoundDetails.holesPlayed);
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
                      You&apos;re on the scorecard already — add playing partners
                      if you weren&apos;t alone.
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

          {/* Score Entry Section. Shown for EVERY shared round, including the
              solo "Playing now" default — playerScores always carries the
              creator's row, so gating on partners hid your own scorecard. */}
          {roundType === 'shared' && (
            <div className="mb-6">
              <div className={GOLF_SECTION_CARD}>
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
          {roundType === 'individual' && (
            <div className="mb-6">
              <div className="bg-green-50 dark:bg-green-950/40 rounded-lg border border-green-200 dark:border-green-800 p-4">
                <GolfScorecardForm
                  onDataChange={(data) => setGolfRoundData(data)}
                />
              </div>

              {/* Generate Caption from Stats */}
              {golfRoundData && (
                <button
                  onClick={() => onCaptionGenerated(generateGolfCaption())}
                  className="mt-3 text-sm text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 font-medium"
                >
                  <i className="fas fa-magic mr-1"></i>
                  Generate caption from scorecard
                </button>
              )}
            </div>
          )}
        </>
      )}

      {/* Participant Selection Modal (for shared rounds). Outside the
          `active` gate on purpose — it was always mounted in CreatePostModal
          regardless of postType. */}
      <TagPeopleModal
        isOpen={showParticipantModal}
        onClose={() => setShowParticipantModal(false)}
        existingTags={sharedRoundParticipants}
        onSelectionComplete={handleParticipantSelection}
        selectionMode={true}
      />
    </>
  );
}
