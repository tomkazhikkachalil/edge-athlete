'use client';

// ── Golf's slice of the post composer ─────────────────────────────────────────
// Extracted wholesale from CreatePostModal (sport-cleanup D-2): every piece of
// golf-only composer state (round timing, round details, course search,
// manual par/yardage, participants, score entry) lives HERE, and the modal
// keeps exactly one sport slot (see src/components/sport-composer-extras.ts).
// The section reports its full value up via `onChange` on every internal
// change; CreatePostModal stores that snapshot and reads it in submit,
// validation, the footer hint and the preview.
//
// ONE FLOW, TWO MODES (golf unification): every golf round rides the
// group-posts rails — "Playing now" goes live and scores hole by hole;
// "Already played" takes the same form, one-pass score entry, and publishes
// once, complete. The old Individual/Shared fork (a separate 868-line form
// writing golf_rounds directly, on which players could not be added at all)
// is gone; "individual" is simply a round with zero invitees.
//
// The section stays MOUNTED while the composer is open even when another sport
// is selected (`active` false) — the old inline state outlived the postType
// toggle, so switching golf → general → golf must keep the scorecard.

import { useState, useCallback, useRef, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { hasAnyEnteredScore, resizePlayerScores } from '@/lib/golf/score-entry';
import { localDayKey } from '@/lib/calendar/grid';
import { courseTeeOptions, teeLabel, FALLBACK_TEES } from '@/lib/golf/tees';
import { useDebouncedCallback } from '@/hooks/useDebouncedCallback';
import { usePopoverDismiss } from '@/hooks/usePopoverDismiss';
import TagPeopleModal from '@/components/TagPeopleModal';
import MultiPlayerScorecardGrid, { type PlayerScoreData, type PlayerHoleScore } from '@/components/golf/MultiPlayerScorecardGrid';
import type { GolfCourse } from '@/types/golf';
import type { SportComposerExtraProps } from '@/components/sport-composer-extras';
import { GOLF_INPUT, GOLF_INPUT_COMPACT, GOLF_SELECT, GOLF_LABEL, GOLF_SECTION_CARD } from '@/components/golf/golf-form-styles';
import CourseInfoCard from '@/components/golf/CourseInfoCard';

/** Full shared-round form state. CreatePostModal's preview only reads the
 *  display fields, but gameFormat/alreadyPlayed drive submission and the
 *  live-vs-batch flow, so the whole object travels in the value. */
export interface GolfSharedRoundDetails {
  courseName: string;
  date: string;
  /** GRID size (18, or 9 when the selected catalog course is a 9-holer) —
   *  NOT the user's choice anymore. What actually counts is DERIVED at
   *  submit from the holes they scored (lib/golf/derive-round.ts): front-9
   *  only → 9-hole round; back-9 only → 9-hole round numbered 10–18 (the
   *  numbering contract is unchanged); anything else → 18, partial when
   *  incomplete. The 9/18 + Front/Back selectors are gone (owner call:
   *  "whatever they record is what gets counted"). */
  holesPlayed: number;
  roundTypeIndoorOutdoor: 'outdoor' | 'indoor';
  gameFormat: 'stroke' | 'stableford' | 'match';
  teeColor: string;
  weather: string;
  temperature: string;
  wind: string;
  /** Course rating/slope for handicap differentials — auto-filled from a
   *  catalog course's selected tee, manually enterable for custom courses.
   *  Strings because they are input values; submit parses. */
  courseRating: string;
  slopeRating: string;
  /** golf_courses.id when the pick came from the catalog; null for custom
   *  and courses-you've-played rows. Feeds golf_scorecard_data.course_id. */
  courseId: string | null;
  /** "Already played" rounds post as FINAL immediately (no LIVE badge, no
   *  resume banner) — for logging rounds after the fact */
  alreadyPlayed: boolean;
}

/** Catalog course ids are golf_courses UUIDs; history rows use `history-*`. */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Everything CreatePostModal's submit paths, validation, footer hint and
 *  preview read — the section's one-way report up. */
export interface GolfComposerValue {
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
 *  Mirrors the section's initial state as observed from outside. */
export function defaultGolfComposerValue(): GolfComposerValue {
  return {
    sharedRoundDetails: {
      courseName: '',
      // localDayKey, not toISOString: UTC's "today" is tomorrow for any US
      // athlete composing after ~5pm Pacific / 8pm Eastern.
      date: localDayKey(new Date()),
      holesPlayed: 18,
      roundTypeIndoorOutdoor: 'outdoor',
      gameFormat: 'stroke',
      teeColor: '',
      weather: '',
      temperature: '',
      wind: '',
      courseRating: '',
      slopeRating: '',
      courseId: null,
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
}: SportComposerExtraProps) {
  // activeProfile first, so a guardian composing AS a managed athlete seeds
  // that athlete's row rather than their own.
  const { profile, activeProfile } = useAuth();
  const displayProfile = activeProfile ?? profile;

  // Round data
  const [sharedRoundParticipants, setSharedRoundParticipants] = useState<string[]>([]);
  const [sharedRoundParticipantsData, setSharedRoundParticipantsData] = useState<{id: string; name: string; avatar_url?: string}[]>([]);
  const [showParticipantModal, setShowParticipantModal] = useState(false);
  const [sharedRoundDetails, setSharedRoundDetails] = useState<GolfSharedRoundDetails>({
    courseName: '',
    date: localDayKey(new Date()), // today, VIEWER-local (not UTC)
    holesPlayed: 18,
    roundTypeIndoorOutdoor: 'outdoor',
    gameFormat: 'stroke',
    teeColor: '',
    weather: '',
    temperature: '',
    wind: '',
    courseRating: '',
    slopeRating: '',
    courseId: null,
    // "Already played" rounds post as FINAL immediately (no LIVE badge, no
    // resume banner) — for logging rounds after the fact
    alreadyPlayed: false,
  });
  // Smart default: picking a past date implies "already played" — but an
  // explicit tap on the toggle wins and stops the auto-flip
  const roundTimingTouchedRef = useRef(false);

  // The grid always starts at hole 1 — back-9 is derived at submit from
  // which holes were filled (the user scores on the Back Nine tab).
  const startingHoleNum = 1;

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
  //
  // `global` rides only on the explicit "search worldwide" button — the
  // server hits external providers for that flag, never for typeahead.
  const [globalSearchAvailable, setGlobalSearchAvailable] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [catalogAttribution, setCatalogAttribution] = useState<string | null>(null);
  const [globalSearchedFor, setGlobalSearchedFor] = useState<string | null>(null);
  const runCourseSearch = useCallback(async (signal: AbortSignal, query: string, global?: boolean) => {
    setSearchLoading(true);
    try {
      const response = await fetch(
        `/api/golf/courses?q=${encodeURIComponent(query)}&limit=20${global ? '&global=1' : ''}`,
        { signal }
      );
      if (response.ok) {
        const data = await response.json();
        setAvailableCourses(data.courses || []);
        setGlobalSearchAvailable(!!data.globalAvailable);
        setCatalogAttribution(data.attribution ?? null);
        setSearchFailed(false);
      } else {
        // The inline "search unavailable" row is the user-facing signal; a
        // 429 is EXPECTED throttling and doesn't belong in the console (the
        // dev overlay paints console.error red). Real server trouble logs.
        if (response.status !== 429) {
          console.error('Failed to search golf courses — status:', response.status);
        }
        setSearchFailed(true);
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

  const searchCourses = useCallback((query: string, opts?: { browse?: boolean }) => {
    if (query.trim().length < 1 && !opts?.browse) {
      // CANCEL, don't just return: an armed timer would still fire and refill
      // the list the user just cleared — and with it the dropdown.
      cancelCourseSearch();
      setAvailableCourses([]);
      return;
    }
    // browse: an empty query lists the catalog head — "show me the courses"
    // was impossible before you knew a name to type.
    debouncedCourseSearch(query.trim());
  }, [debouncedCourseSearch, cancelCourseSearch]);

  // Outside press + Escape, instead of a viewport-covering backdrop div.
  const courseFieldRef = useRef<HTMLDivElement>(null);
  const courseDropdownRef = useRef<HTMLDivElement>(null);
  const closeCourseSearch = useCallback(() => {
    setCourseSearchOpen(false);
    setAvailableCourses([]);
  }, []);
  // Also open with ZERO local hits when a worldwide search is possible —
  // that empty-local case is exactly when the button matters.
  const trimmedCourseQuery = courseSearchQuery.trim();
  const worldwideOffer =
    globalSearchAvailable && trimmedCourseQuery.length >= 3 && globalSearchedFor !== trimmedCourseQuery;
  const courseDropdownOpen =
    courseSearchOpen && (availableCourses.length > 0 || worldwideOffer || searchFailed);
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

  /** Par/yardage rows for the CURRENT hole range from a catalog course.
   *  Tee keys are free text now (provider tee names) — selected tee first,
   *  then white/blue, then ANY tee the course has. */
  const deriveCourseHoles = useCallback(
    (course: GolfCourse, teeColor: string, holes: number, start: number) => {
      return course.holes
        .filter(hole => hole.number >= start && hole.number < start + holes)
        .map(hole => ({
          hole: hole.number,
          par: hole.par,
          yardage: hole.yardage[teeColor || 'white'] ?? hole.yardage.white ?? hole.yardage.blue
            ?? Object.values(hole.yardage)[0] ?? 400
        }));
    },
    []
  );

  // Select a course from search results.
  const selectedCourseIdRef = useRef<string | null>(null);

  /** Apply a course's data to the form (also re-run by hydration below). */
  const applyCourseData = useCallback((course: GolfCourse) => {
    const teeColor = sharedRoundDetails.teeColor;
    setSharedRoundDetails(prev => ({
      ...prev,
      courseName: course.name,
      // Catalog rows carry golf_courses.id (a UUID) → golf_scorecard_data.
      // History rows carry a synthetic `history-*` id → null.
      courseId: UUID_SHAPE.test(course.id) ? course.id : null,
      // Grid size follows the course: a 9-hole course shows a 9-hole card.
      holesPlayed: course.holesCount === 9 ? 9 : 18,
      // Rating/slope feed handicap differentials — carry the selected tee's
      // values, falling back to white, then to ANY tee the course has:
      // courses-you've-played suggestions carry ratings keyed by whichever
      // tee the historical round used (e.g. only `blue`), so the white-only
      // fallback silently filled nothing for them.
      courseRating: String(
        course.courseRating?.[teeColor || 'white'] ?? course.courseRating?.white ??
          Object.values(course.courseRating ?? {})[0] ?? prev.courseRating ?? ''
      ),
      slopeRating: String(
        course.slopeRating?.[teeColor || 'white'] ?? course.slopeRating?.white ??
          Object.values(course.slopeRating ?? {})[0] ?? prev.slopeRating ?? ''
      ),
    }));

    // Auto-populate par and yardage from course data for the current range
    setCourseHoleData(
      deriveCourseHoles(course, teeColor, course.holesCount === 9 ? 9 : 18, 1)
    );

    // Clear manual entry ONLY when the course actually brought hole data.
    // Most of the catalog is OSM identity rows (no pars, ever): selecting
    // one ran this twice — on pick and again when the hydration echo came
    // back still thin, a second or two later — and wiped pars typed in that
    // window.
    if (course.holes.length > 0) {
      setManualParEntry([]);
      setManualYardageEntry([]);
    }
  }, [sharedRoundDetails, deriveCourseHoles]);

  const selectCourse = useCallback((course: GolfCourse) => {
    setSelectedCourse(course);
    selectedCourseIdRef.current = course.id;
    applyCourseData(course);
    setCourseSearchOpen(false);
    setCourseSearchQuery('');
    // Cancel first: a response already in flight would otherwise land after
    // this and refill the list, re-opening the dropdown over a chosen course.
    cancelCourseSearch();
    setAvailableCourses([]);

    // Hydration: a provider row from a worldwide search is THIN (identity
    // only) until its first selection — one detail fetch fills ratings and
    // holes server-side and returns the full course. Plain callback, not an
    // effect; guarded so a stale response can't clobber a newer selection.
    const isThin =
      course.holes.length === 0 &&
      Object.keys(course.courseRating ?? {}).length === 0 &&
      Object.keys(course.slopeRating ?? {}).length === 0;
    if (isThin && UUID_SHAPE.test(course.id)) {
      fetch(`/api/golf/courses?id=${encodeURIComponent(course.id)}`)
        .then(res => (res.ok ? res.json() : null))
        .then(data => {
          const full: GolfCourse | undefined = data?.course;
          if (!full || selectedCourseIdRef.current !== course.id) return;
          setSelectedCourse(full);
          applyCourseData(full);
        })
        .catch(() => { /* thin data stands; the course is still usable */ });
    }
  }, [applyCourseData, cancelCourseSearch]);

  // Initialize player scores when participants are added
  const initializePlayerScores = useCallback((participants: {id: string; name: string; avatar_url?: string}[], holes: number, start: number) => {
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
            hole_number: start + i,
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

  // Hole-range synchronisation (render-phase, the house idiom): a 9/18 or
  // front↔back change rebuilds every row for the new range (preserving
  // overlapping holes) and re-derives DB-course pars. initializePlayerScores
  // only ever ADDS players and the change handler only maps existing slots,
  // so without this a row built for 18 holes would keep 18 slots forever.
  const [syncedRange, setSyncedRange] = useState({ holes: 18, start: 1 });
  if (syncedRange.holes !== sharedRoundDetails.holesPlayed || syncedRange.start !== startingHoleNum) {
    setSyncedRange({ holes: sharedRoundDetails.holesPlayed, start: startingHoleNum });
    setPlayerScores(prev => resizePlayerScores(prev, sharedRoundDetails.holesPlayed, startingHoleNum));
    if (selectedCourse) {
      setCourseHoleData(
        deriveCourseHoles(selectedCourse, sharedRoundDetails.teeColor, sharedRoundDetails.holesPlayed, startingHoleNum)
      );
    }
  }

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
  // as the hole-range sync above), and the guard is self-clearing — once the
  // row exists the condition is false.
  const creatorName = displayProfile
    ? (displayProfile.first_name && displayProfile.last_name
        ? `${displayProfile.first_name} ${displayProfile.last_name}`
        : displayProfile.full_name || 'You')
    : null;

  if (
    active &&
    userId &&
    creatorName &&
    !playerScores.some(p => p.participant_id === userId)
  ) {
    initializePlayerScores(
      [{ id: userId, name: creatorName, avatar_url: displayProfile?.avatar_url ?? undefined }],
      sharedRoundDetails.holesPlayed,
      startingHoleNum
    );
  }

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
      initializePlayerScores(profilesData, sharedRoundDetails.holesPlayed, startingHoleNum);
    }
  };

  // Remove participant
  const removeParticipant = (profileId: string) => {
    setSharedRoundParticipants(prev => prev.filter(id => id !== profileId));
    setSharedRoundParticipantsData(prev => prev.filter(p => p.id !== profileId));
    // Also remove from scores
    setPlayerScores(prev => prev.filter(p => p.participant_id !== profileId));
  };

  // Report the full golf value up on every internal change. One-way flow:
  // the parent never pushes golf state back down, so this effect only
  // synchronizes React state OUT to the owner (via a prop callback — no
  // setState of this component's own happens here).
  useEffect(() => {
    // Course + date only. Playing partners are NOT required: you are always
    // on the scorecard yourself, so a solo round is a complete round whether
    // it is live or already played. Weather is optional too.
    const isValid = Boolean(
      sharedRoundDetails.courseName.trim().length > 0 &&
      sharedRoundDetails.date
    );

    // Golf's share of the composer's unsaved-work check.
    const isDirty =
      sharedRoundParticipants.length > 0 ||
      selectedCourse !== null ||
      sharedRoundDetails.courseName.trim() !== '' ||
      manualParEntry.length > 0 ||
      manualYardageEntry.length > 0 ||
      // A seeded row is not work. Counting playerScores.length here would make
      // the composer dirty the instant golf is selected, so every close would
      // prompt to discard work nobody started (that exact bug shipped once via
      // the old roundType field). Only an actual stroke counts.
      hasAnyEnteredScore(playerScores);

    const start = 1;
    onChange({
      sharedRoundDetails,
      sharedRoundParticipants,
      sharedRoundParticipantsData,
      playerScores,
      courseHoleData,
      manualParEntry,
      manualYardageEntry,
      holeParSource: courseHoleData.length > 0
        ? courseHoleData
        : manualParEntry.map((par, idx) => ({ hole: start + idx, par })).filter(h => h.par > 0),
      isValid,
      isDirty,
    });
  }, [
    onChange,
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

          {/* Round Details Form — ONE flow: the old Individual/Shared fork is
              gone; "individual" is simply a round with zero invitees. */}
          {(
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
                        // Clear selected course if user types manually —
                        // including the catalog link: a hand-edited name is
                        // no longer that course.
                        if (selectedCourse && e.target.value !== selectedCourse.name) {
                          setSelectedCourse(null);
                          selectedCourseIdRef.current = null;
                          setSharedRoundDetails(prev => ({
                            ...prev,
                            courseId: null,
                            holesPlayed: 18,
                            // A course-specific tee name means nothing on a
                            // hand-typed course — keep only classic colors.
                            teeColor: (FALLBACK_TEES as readonly string[]).includes(prev.teeColor) ? prev.teeColor : '',
                          }));
                        }
                      }}
                      onFocus={() => {
                        setCourseSearchOpen(true);
                        // Empty input browses the catalog head — the field
                        // answers "what courses are there?" on first tap.
                        searchCourses(courseSearchQuery, { browse: true });
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
                          {(course.city || course.state) && (
                            <div className="text-sm text-tertiary">
                              {[course.city, course.state].filter(Boolean).join(', ')}
                            </div>
                          )}
                          {/* Thin provider rows have no hole data until first
                              selection — "0 holes" read as broken, so say
                              what actually happens instead. OSM rows never
                              get details (no provider knows them), so they
                              say THAT rather than promise a load. */}
                          <div className="text-xs text-muted mt-1">
                            {course.holes.length > 0
                              ? `Par ${course.totalPar} • ${course.holes.length} holes`
                              : course.source === 'osm'
                                ? 'Map location only — enter pars manually'
                                : 'Details load when selected'}
                          </div>
                        </button>
                      ))}
                      {searchFailed && (
                        <div className="px-4 py-3 text-sm text-tertiary">
                          Course search is unavailable right now — you can
                          keep typing the course name and try again in a
                          minute.
                        </div>
                      )}
                      {/* The ONLY trigger for external course providers —
                          worldwide search is explicit, never per keystroke
                          (free-tier budgets; see course-catalog.ts). */}
                      {worldwideOffer && (
                        <button
                          type="button"
                          onClick={() => {
                            setGlobalSearchedFor(trimmedCourseQuery);
                            debouncedCourseSearch(trimmedCourseQuery, true);
                          }}
                          className="w-full px-4 py-3 text-left text-sm font-medium text-brand-fg hover:bg-brand-soft transition-colors border-t border-border-subtle"
                        >
                          <i className="fas fa-globe mr-2" aria-hidden="true"></i>
                          Search all courses worldwide for &ldquo;{trimmedCourseQuery}&rdquo;
                        </button>
                      )}
                      {catalogAttribution && (
                        <div className="px-4 py-1.5 text-[10px] text-faint border-t border-border-subtle">
                          {catalogAttribution}
                        </div>
                      )}
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
                  {selectedCourse && <CourseInfoCard course={selectedCourse} />}

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
                          : { alreadyPlayed: date < localDayKey(new Date()) }),
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

                {/* Tees (optional, outdoor only) — a catalog course lists
                    its REAL tees (hardest first); picking one re-fills that
                    tee's exact rating/slope and per-hole yardages. Custom
                    and history courses keep the classic five colors. */}
                {sharedRoundDetails.roundTypeIndoorOutdoor === 'outdoor' && (
                  <div className="mb-4">
                    <label className={GOLF_LABEL}>
                      {selectedCourse ? 'Tees (optional)' : 'Tee Color (optional)'}
                    </label>
                    <select
                      value={sharedRoundDetails.teeColor}
                      onChange={(e) => {
                        const tee = e.target.value;
                        const course = selectedCourse;
                        setSharedRoundDetails(prev => ({
                          ...prev,
                          teeColor: tee,
                          // Re-fill THIS tee's rating/slope (the flagged
                          // follow-up from the catalog round — tee changes
                          // used to leave the old tee's numbers standing).
                          ...(course && tee
                            ? {
                                courseRating: String(
                                  course.courseRating?.[tee] ??
                                    Object.values(course.courseRating ?? {})[0] ?? prev.courseRating ?? ''
                                ),
                                slopeRating: String(
                                  course.slopeRating?.[tee] ??
                                    Object.values(course.slopeRating ?? {})[0] ?? prev.slopeRating ?? ''
                                ),
                              }
                            : {}),
                        }));
                        if (course && tee) {
                          setCourseHoleData(
                            deriveCourseHoles(course, tee, course.holesCount === 9 ? 9 : 18, 1)
                          );
                        }
                      }}
                      className={GOLF_SELECT}
                    >
                      <option value="">{selectedCourse ? 'Select tees' : 'Select tee color'}</option>
                      {courseTeeOptions(selectedCourse).map(key => (
                        <option key={key} value={key}>{teeLabel(key)}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Course rating & slope — the key that unlocks the computed
                    handicap (trends hard-requires both, non-null, 18 holes).
                    Promoted OUT of the buried "Par & Yardage (Optional)" box:
                    DB/history courses auto-fill these on pick (visible and
                    editable here), custom courses get typed in. Shown once a
                    course is named; still optional — never a gauntlet. */}
                {sharedRoundDetails.courseName && (
                  <div className="mb-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={GOLF_LABEL}>Course Rating (optional)</label>
                        <input
                          type="number"
                          step="0.1"
                          min="50"
                          max="90"
                          value={sharedRoundDetails.courseRating}
                          onChange={(e) => setSharedRoundDetails(prev => ({ ...prev, courseRating: e.target.value }))}
                          placeholder="e.g. 72.4"
                          className={GOLF_INPUT_COMPACT}
                        />
                      </div>
                      <div>
                        <label className={GOLF_LABEL}>Slope Rating (optional)</label>
                        <input
                          type="number"
                          min="55"
                          max="155"
                          value={sharedRoundDetails.slopeRating}
                          onChange={(e) => setSharedRoundDetails(prev => ({ ...prev, slopeRating: e.target.value }))}
                          placeholder="e.g. 128"
                          className={GOLF_INPUT_COMPACT}
                        />
                      </div>
                    </div>
                    <p className="mt-1.5 text-xs text-tertiary">
                      18-hole rounds with a course rating and slope unlock your estimated handicap — both are on the course&apos;s scorecard.
                    </p>
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

                    {/* Rating/slope inputs used to live here, invisible to
                        anyone who picked a DB course — they moved up into the
                        main round-details card next to Tee Color. */}
                    <div className="max-h-64 overflow-y-auto overscroll-contain">
                      <div className="grid grid-cols-1 gap-3">
                        {Array.from({ length: sharedRoundDetails.holesPlayed }, (_, i) => {
                          const holeNum = startingHoleNum + i;
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
                      {`Playing with anyone? Optional (${sharedRoundParticipants.length})`}
                    </label>
                    <div className="flex items-center gap-2">
                      {/* The old "+ Add Myself" button (already-played only) is
                          gone: the creator's row is always seeded and the
                          server always inserts the creator — it only implied
                          partners were required. */}
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

          {/* Score Entry Section. Shown for EVERY round, including the solo
              "Playing now" default — playerScores always carries the
              creator's row, so gating on partners hid your own scorecard.
              For "Already played" this IS the one-pass manual entry. */}
          <div className="mb-6">
            <div className={GOLF_SECTION_CARD}>
              <h3 className="text-lg font-semibold text-primary mb-4 flex items-center">
                <i className="fas fa-list-ol mr-2 text-green-600 dark:text-green-400"></i>
                Score Entry
              </h3>
              <p className="text-sm text-tertiary mb-4">
                {sharedRoundDetails.alreadyPlayed
                  ? 'Enter the finished round below — the post publishes once, complete.'
                  : 'Enter scores below or leave blank - participants can add them later'}
              </p>

              {/* Multi-player scorecard grid - always shown */}
              <div>
                <MultiPlayerScorecardGrid
                    players={playerScores}
                    holes={sharedRoundDetails.holesPlayed}
                    startingHoleNumber={startingHoleNum}
                    courseName={sharedRoundDetails.courseName || undefined}
                    editable={true}
                    showDetailedStats={false}
                    onScoreChange={handlePlayerScoreChange}
                    holeData={
                      // Use course data if available, otherwise manual entry
                      courseHoleData.length > 0
                        ? courseHoleData
                        : manualParEntry.length > 0 || manualYardageEntry.length > 0
                        ? Array.from({ length: sharedRoundDetails.holesPlayed }, (_, i) => ({
                            hole: startingHoleNum + i,
                            par: manualParEntry[i] || 4,
                            yardage: manualYardageEntry[i] || undefined
                          }))
                        : undefined
                    }
                  />
              </div>
            </div>
          </div>
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
