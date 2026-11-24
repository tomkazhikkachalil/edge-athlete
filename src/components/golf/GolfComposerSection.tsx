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
// "Already played" takes the same steps, one-pass score entry, and publishes
// once, complete. The old Individual/Shared fork (a separate 868-line form
// writing golf_rounds directly, on which players could not be added at all)
// is gone; "individual" is simply a round with zero invitees.
//
// The section stays MOUNTED while the composer is open even when another sport
// is selected (`active` false) — the old inline state outlived the postType
// toggle, so switching golf → general → golf must keep the scorecard.

import { useState, useCallback, useRef, useEffect } from 'react';
import SectionInfo, { InfoButton, InfoPanel, useInfoDisclosure } from '@/components/SectionInfo';
import { requestPosition, POSITION_DENIED, type DeviceFix } from '@/lib/geo/request-position';
import { formatKm, nearbyOffer, NEAR_RADIUS_KM } from '@/lib/golf/near-me';
import { UUID_RE as UUID_SHAPE } from '@/lib/uuid';
import { useAuth } from '@/lib/auth';
import { hasAnyEnteredScore, resizePlayerScores } from '@/lib/golf/score-entry';
import { localDayKey } from '@/lib/calendar/grid';
import { courseTeeOptions, teeLabel, FALLBACK_TEES, hasBothTeeSides, isWomensTee, splitTeeSides, ratingEntryNeeded } from '@/lib/golf/tees';
import { useDebouncedCallback } from '@/hooks/useDebouncedCallback';
import { usePopoverDismiss } from '@/hooks/usePopoverDismiss';
import TagPeopleModal from '@/components/TagPeopleModal';
import MultiPlayerScorecardGrid, { type PlayerScoreData, type PlayerHoleScore } from '@/components/golf/MultiPlayerScorecardGrid';
import type { GolfCourse } from '@/types/golf';
import { deriveCourseHoles as deriveCourseHolesPure } from '@/lib/golf/holes';
import { isMapSheet } from '@/lib/golf/map-sheet';
import { composeCourses, buildComposition, type CourseComposition } from '@/lib/golf/course-sections';
import { courseSummary, teeChoiceLabel, type TeeTotal } from '@/lib/golf/course-summary';
import type { SportComposerExtraProps } from '@/components/sport-composer-extras';
import { GOLF_INPUT_COMPACT, GOLF_LABEL, GOLF_SECTION_CARD } from '@/components/golf/golf-form-styles';
import CourseInfoCard from '@/components/golf/CourseInfoCard';
import { formatPlace } from '@/lib/geo/regions';
import StepFlow from '@/components/StepFlow';
import RoundTypeStep from '@/components/golf/round-steps/RoundTypeStep';
import CoursePlate from '@/components/golf/round-steps/CoursePlate';
import DialCluster from '@/components/golf/round-steps/DialCluster';
import TeeTable from '@/components/golf/round-steps/TeeTable';
import KeySwitch from '@/components/mech/KeySwitch';
import LogoDevAttribution from '@/components/LogoDevAttribution';
import { logoUrl, websiteDomain } from '@/lib/logo-dev';
import { dialValue } from '@/lib/golf/dial';
import { faChevronRight } from '@/lib/icons/fa/chevron-right';
import FormatStep, { gameFormatLabel } from '@/components/golf/round-steps/FormatStep';
import ConditionsStep, { type ForecastFilled } from '@/components/golf/round-steps/ConditionsStep';
import { loadWeather } from '@/lib/weather/weather-client';
import { golfConditionOf, golfTempF, golfWindBandOf, wmoLabel } from '@/lib/weather/weather';
import type { WeatherStatus } from '@/hooks/useWeather';
import { useUnitSystem } from '@/hooks/useUnitSystem';
import { fromInput, QUANTITY_UNITS, toDisplay } from '@/lib/activities/units';
import { AvatarImage } from '@/components/OptimizedImage';
import { getInitials } from '@/lib/formatters';
import { handicapSuffix } from '@/lib/golf/handicaps';
import {
  FIRST_ROUND_STEP,
  conditionsLine,
  roundBusyLabel,
  roundDateForMode,
  roundFinishLabel,
  roundStepIndex,
  roundStepRefusal,
  roundFrame,
  stepsForRound,
  type RoundStepId,
} from '@/lib/golf/round-steps';
import FaIcon from '@/components/FaIcon';
import { faBolt } from '@/lib/icons/fa/bolt';
import { faEye } from '@/lib/icons/fa/eye';
import { faFlagCheckered } from '@/lib/icons/fa/flag-checkered';
import { faGlobe } from '@/lib/icons/fa/globe';
import { faListOl } from '@/lib/icons/fa/list-ol';
import { faLocationCrosshairs } from '@/lib/icons/fa/location-crosshairs';
import { faLocationDot } from '@/lib/icons/fa/location-dot';
import { faMagnifyingGlass } from '@/lib/icons/fa/magnifying-glass';
import { faPaperPlane } from '@/lib/icons/fa/paper-plane';
import { faPenToSquare } from '@/lib/icons/fa/pen-to-square';
import { faSpinner } from '@/lib/icons/fa/spinner';
import { faUserPlus } from '@/lib/icons/fa/user-plus';
import { faXmark } from '@/lib/icons/fa/xmark';
import { faCircleDot } from '@/lib/icons/fa/circle-dot';

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
  /** Where the conditions came from (Oct 29 2026): 'forecast' when the
   *  Conditions step's button filled them from Open-Meteo at the course;
   *  'manual' once a person types. Absent = never asked. */
  conditionsSource?: 'manual' | 'forecast';
  /** The forecast's observation time (epoch seconds) when it was a forecast. */
  conditionsAt?: number | null;
  /** Course rating/slope for handicap differentials — auto-filled from a
   *  catalog course's selected tee, manually enterable for custom courses.
   *  Strings because they are input values; submit parses. */
  courseRating: string;
  slopeRating: string;
  /** golf_courses.id when the pick came from the catalog; null for custom
   *  and courses-you've-played rows. Feeds golf_scorecard_data.course_id.
   *  For a two-nine combo this is the FRONT nine's row (the convention
   *  course_composition documents). */
  courseId: string | null;
  /** Two-nine combo at a multi-course club (migration 125): which nine is
   *  holes 1–9 and which is 10–18. Null for every single-course round.
   *  Feeds golf_scorecard_data.course_composition. */
  courseComposition: CourseComposition | null;
  /** "Already played" rounds post as FINAL immediately (no LIVE badge, no
   *  resume banner) — for logging rounds after the fact */
  alreadyPlayed: boolean;
}

/** Catalog course ids are golf_courses UUIDs; history rows use `history-*`. */
/** A sibling section row at a multi-course club (from ?id= hydration). */
interface SectionSibling {
  id: string;
  name: string;
  sectionName?: string;
  sectionKind?: string;
  holesCount?: number;
}

const isNineOption = (s: SectionSibling) => s.sectionKind === 'nine' || s.holesCount === 9;

/** Everything CreatePostModal's submit paths, validation, footer hint and
 *  preview read — the section's one-way report up. */
export interface GolfComposerValue {
  sharedRoundDetails: GolfSharedRoundDetails;
  sharedRoundParticipants: string[];
  sharedRoundParticipantsData: { id: string; name: string; avatar_url?: string }[];
  playerScores: PlayerScoreData[];
  courseHoleData: { hole: number; par: number; yardage?: number; handicap?: number }[];
  manualParEntry: number[];
  manualYardageEntry: number[];
  /** Real per-hole pars for the preview: course search first, manual entry
   *  second — the same derivation CreatePostModal inlined before extraction. */
  holeParSource: { hole: number; par: number }[];
  /** The golf branch of the composer's submit gate. */
  isValid: boolean;
  /** Golf's share of the composer's unsaved-work check. */
  isDirty: boolean;
  /** The step the person is on (Oct 28 2026) — rides the crash draft so a
   *  restore lands where they were. */
  stepId: RoundStepId;
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
      courseComposition: null,
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
    stepId: FIRST_ROUND_STEP,
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

type TeeSide = 'men' | 'women';
const TEE_SIDE_OPTIONS = [
  { value: 'men' as TeeSide, label: 'Men' },
  { value: 'women' as TeeSide, label: 'Women' },
] as const;

/** One course in a list of the course step (results, nearby, recent): the
 *  name on one line, the place or the distance under it, a chevron. */
function CourseRow({ course, showKm, divided, onPick }: { course: GolfCourse; showKm: boolean; divided: boolean; onPick: (course: GolfCourse) => void }) {
  const [pressed, setPressed] = useState(false);
  const release = () => setPressed(false);
  const place = formatPlace({ city: course.city, region: course.state, country: course.country });
  // Thin provider rows have no hole data until first selection — "0 holes"
  // read as broken, so say what actually happens instead. OSM rows never
  // get details (no provider knows them), so they say THAT rather than
  // promise a load.
  const sheet = course.holes.length > 0
    ? `Par ${course.totalPar} • ${course.holes.length} holes`
    : course.source !== 'osm' && course.hydratedAt
      ? 'No hole data from the provider yet'
      : 'Details load when selected';
  const km = showKm && typeof course.distanceKm === 'number' ? formatKm(course.distanceKm) : null;
  return (
    <button
      type="button"
      onClick={() => onPick(course)}
      data-course-row={course.id}
      {...(pressed ? { 'data-pressed': '' } : {})}
      onPointerDown={() => setPressed(true)}
      onPointerUp={release}
      onPointerLeave={release}
      onPointerCancel={release}
      className="ea-mech-row w-full flex items-center gap-2 h-14 pl-3.5 pr-3 text-left"
      style={divided ? { borderTop: '1px solid var(--mech-divider)' } : undefined}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-[color:var(--mech-text)]">{course.name}</span>
        <span className="block truncate text-xs text-[color:var(--mech-text-soft)]">
          {km && <span data-course-km="">{km} · </span>}
          {place || sheet}
          {place ? ` · ${sheet}` : ''}
        </span>
      </span>
      <FaIcon icon={faChevronRight} className="text-[16px] text-[color:var(--mech-chevron)]" />
    </button>
  );
}

export default function GolfComposerSection({
  userId,
  active,
  onChange,
  seed,
  onFinish,
  onPreview,
  busy = false,
  busyLabel,
  finishSlot,
  lead,
  onFrame,
}: SportComposerExtraProps) {
  // activeProfile first, so a guardian composing AS a managed athlete seeds
  // that athlete's row rather than their own.
  const { profile, activeProfile } = useAuth();
  const [scoreInfoRef, scoreInfo] = useInfoDisclosure('Score Entry');
  const displayProfile = activeProfile ?? profile;

  // Round data. `seed` (crash-draft restore) wins over the blank defaults —
  // it is read once as initializers, which is safe because the slot is
  // remount-keyed (reset-by-remount contract in sport-composer-extras.ts).
  const [sharedRoundParticipants, setSharedRoundParticipants] = useState<string[]>(
    () => seed?.sharedRoundParticipants ?? []
  );
  const [sharedRoundParticipantsData, setSharedRoundParticipantsData] = useState<{id: string; name: string; avatar_url?: string}[]>(
    () => seed?.sharedRoundParticipantsData ?? []
  );
  const [showParticipantModal, setShowParticipantModal] = useState(false);
  const [sharedRoundDetails, setSharedRoundDetails] = useState<GolfSharedRoundDetails>(() => seed?.sharedRoundDetails ?? {
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
    courseComposition: null,
    // "Already played" rounds post as FINAL immediately (no LIVE badge, no
    // resume banner) — for logging rounds after the fact
    alreadyPlayed: false,
  });
  // The step the person is on, by id (round-steps.ts). A restored draft
  // lands where it was; an id the current list lacks starts over.
  const [stepId, setStepId] = useState<RoundStepId>(() => seed?.stepId ?? FIRST_ROUND_STEP);

  // The grid always starts at hole 1 — back-9 is derived at submit from
  // which holes were filled (the user scores on the Back Nine tab).
  const startingHoleNum = 1;

  // Golf course search for shared rounds
  const [courseSearchOpen, setCourseSearchOpen] = useState(false);
  const [courseSearchQuery, setCourseSearchQuery] = useState('');
  const [availableCourses, setAvailableCourses] = useState<GolfCourse[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState<GolfCourse | null>(null);
  // The course step's two views (Nov 23 2026): the search, until a course is
  // picked or a typed name is "added manually"; then the picked course. A
  // restored draft carries the name but not the catalog row, so it comes
  // back as the hand-typed course it then is.
  const [manualCourse, setManualCourse] = useState<boolean>(() => !!seed?.sharedRoundDetails?.courseName?.trim());
  // Men | Women over the tee table: null follows the tee in play.
  const [teeSideChoice, setTeeSideChoice] = useState<TeeSide | null>(null);
  // The account's own last courses (GET /api/golf/courses?recent=1), asked
  // once when the course step first shows.
  const [recentCourses, setRecentCourses] = useState<GolfCourse[]>([]);
  const recentAskedRef = useRef(false);
  // What the last ANSWERED search was for — "No course found" is only ever
  // said about the text an answer actually came back for.
  const [searchedFor, setSearchedFor] = useState<string | null>(null);
  // The picked course's open panel (the course card reports it): the
  // scorecard asks for the full frame on a desktop.
  const [coursePanel, setCoursePanel] = useState<'map' | 'scorecard' | null>(null);

  // Weather at the course (Oct 29 2026): the Conditions step's button asks
  // for the COURSE's cell on a TAP (never on entry) and fills the three
  // fields; a live round only — an already-played round keeps what the
  // person types. The temperature column stays Fahrenheit; the step shows
  // the viewer's unit (units.ts), read once per mount.
  const { sys: unitSys, setSys: setUnitSys } = useUnitSystem();
  const [forecastStatus, setForecastStatus] = useState<WeatherStatus>('idle');
  const [forecastFilled, setForecastFilled] = useState<ForecastFilled | null>(null);
  const fillFromForecast = async () => {
    if (!selectedCourse || selectedCourse.lat == null || selectedCourse.lng == null) return;
    setForecastStatus('loading');
    const w = await loadWeather({ lat: selectedCourse.lat, lng: selectedCourse.lng });
    if (!w) {
      setForecastStatus('unavailable');
      return;
    }
    setSharedRoundDetails(prev => ({
      ...prev,
      weather: golfConditionOf(w),
      temperature: String(golfTempF(w.tempC)),
      wind: golfWindBandOf(w.windKmh),
      conditionsSource: 'forecast',
      conditionsAt: w.observedAt,
    }));
    setForecastFilled({ text: wmoLabel(w.code, w.isDay).text, tempC: w.tempC, windKmh: w.windKmh });
    setForecastStatus('ready');
  };
  const forgetForecast = () => {
    setForecastFilled(null);
    setForecastStatus('idle');
  };

  // Course hole data (par and yardage per hole)
  const [courseHoleData, setCourseHoleData] = useState<{ hole: number; par: number; yardage?: number; handicap?: number }[]>(
    () => seed?.courseHoleData ?? []
  );
  const [manualParEntry, setManualParEntry] = useState<number[]>(() => seed?.manualParEntry ?? []);
  const [manualYardageEntry, setManualYardageEntry] = useState<number[]>(
    () => seed?.manualYardageEntry ?? []
  );

  // Shared round score entry
  const [playerScores, setPlayerScores] = useState<PlayerScoreData[]>(() => seed?.playerScores ?? []);
  // Counter prop for the grid's hole-by-hole stepper — each bump opens it
  // (resume mode) for the first player. See the Score Entry header button.
  const [quickEntryRequest, setQuickEntryRequest] = useState(0);

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
  const runCourseSearch = useCallback(async (signal: AbortSignal, query: string, global?: boolean, near?: DeviceFix | null) => {
    setSearchLoading(true);
    try {
      // Near me (Oct 2026): a location request with NO typed text — the
      // catalog sorts by distance (and the provider's proximity joins in on
      // a paid plan, server-side). Never on a keystroke.
      const nearQs = near ? `&near=${near.lat},${near.lng}&radius=${NEAR_RADIUS_KM}` : '';
      const response = await fetch(
        `/api/golf/courses?q=${encodeURIComponent(query)}&limit=20${global ? '&global=1' : ''}${nearQs}`,
        { signal }
      );
      if (response.ok) {
        const data = await response.json();
        setAvailableCourses(data.courses || []);
        setSearchedFor(query);
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

  // "Near me": one fix on the tap; the list is re-asked sorted by distance;
  // typing afterwards is plain typeahead again (one-shot). When the player is
  // standing on a course, the dropdown offers it first — "Playing at X?".
  const [nearFix, setNearFix] = useState<DeviceFix | null>(null);
  const [nearBusy, setNearBusy] = useState(false);
  const [nearError, setNearError] = useState<string | null>(null);
  const findNearMe = useCallback(async () => {
    if (nearBusy) return;
    setNearBusy(true);
    setNearError(null);
    try {
      const fix = await requestPosition();
      setNearFix(fix);
      setCourseSearchQuery('');
      setCourseSearchOpen(true);
      cancelCourseSearch();
      debouncedCourseSearch('', false, fix);
    } catch (e) {
      setNearError(e instanceof Error ? e.message : POSITION_DENIED);
    } finally {
      setNearBusy(false);
    }
  }, [nearBusy, cancelCourseSearch, debouncedCourseSearch]);

  // Search first (Oct 30 2026, Tom's follow-up — the Oct 28 "Near me on
  // entry when already granted" is withdrawn): entering the course step puts
  // the cursor in the EMPTY search field, and nothing location-based happens
  // until the Near me tap, in every mode. The focus follows the sport
  // picker's rule — only behind a fine pointer (a phone shows no keyboard
  // and never zooms to a field it did not tap), never a bare `autoFocus` —
  // and it must not open the catalog browse the way a real tap does.
  const courseInputRef = useRef<HTMLInputElement>(null);
  const programmaticFocusRef = useRef(false);
  useEffect(() => {
    if (!active || stepId !== 'course' || typeof window === 'undefined') return;
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    const input = courseInputRef.current;
    if (!input || input.value.trim() !== '' || document.activeElement === input) return;
    programmaticFocusRef.current = true;
    input.focus({ preventScroll: true });
    // A browser that did not fire focus (a hidden input) must not leave the
    // flag armed for the next real tap.
    if (document.activeElement !== input) programmaticFocusRef.current = false;
  }, [active, stepId]);

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
  const nearOffer = nearFix ? nearbyOffer(availableCourses, nearFix) : null;
  usePopoverDismiss(courseFieldRef, courseDropdownOpen, closeCourseSearch);

  /** Par/yardage rows for the CURRENT hole range from a catalog course —
   *  the pure rule lives in holes.ts (H2: an unknown yardage stays unknown). */
  const deriveCourseHoles = useCallback(
    (course: GolfCourse, teeColor: string, holes: number, start: number) =>
      deriveCourseHolesPure(course.holes, teeColor, holes, start),
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

  // ── Multi-course clubs (migration 125): section chooser ────────────────
  // A selected row linked to a club with siblings prompts "which course /
  // which nines?". comboFront holds the first nine of a two-nine 18 while
  // the back nine is being picked.
  const [sectionChoice, setSectionChoice] = useState<{
    club: { id: string; name: string };
    options: SectionSibling[];
  } | null>(null);
  const [comboFront, setComboFront] = useState<GolfCourse | null>(null);
  const [sectionLoading, setSectionLoading] = useState(false);

  /** Full row fetch for a section pick; null on any failure (non-fatal). */
  const fetchFullCourse = useCallback(async (id: string): Promise<GolfCourse | null> => {
    try {
      const res = await fetch(`/api/golf/courses?id=${encodeURIComponent(id)}`);
      if (!res.ok) return null;
      const data = await res.json();
      return (data?.course as GolfCourse) ?? null;
    } catch {
      return null;
    }
  }, []);

  const selectCourse = useCallback((course: GolfCourse) => {
    setSelectedCourse(course);
    selectedCourseIdRef.current = course.id;
    applyCourseData(course);
    // A fresh selection is a single course until the chooser says otherwise.
    setSharedRoundDetails(prev => ({ ...prev, courseComposition: null }));
    setSectionChoice(null);
    setComboFront(null);
    setTeeSideChoice(null);
    setCourseSearchOpen(false);
    setCourseSearchQuery('');
    // Cancel first: a response already in flight would otherwise land after
    // this and refill the list, re-opening the dropdown over a chosen course.
    cancelCourseSearch();
    setAvailableCourses([]);

    // Hydration: a provider row from a worldwide search is THIN (identity
    // only) until its first selection — one detail fetch fills ratings and
    // holes server-side and returns the full course. Also the club/siblings
    // touchpoint: a row at a multi-course club needs the sibling list to
    // offer the section chooser, so those fetch too even when not thin.
    // Plain callback, not an effect; guarded so a stale response can't
    // clobber a newer selection.
    const isThin =
      course.holes.length === 0 &&
      Object.keys(course.courseRating ?? {}).length === 0 &&
      Object.keys(course.slopeRating ?? {}).length === 0;
    if ((isThin || course.clubId) && UUID_SHAPE.test(course.id)) {
      fetch(`/api/golf/courses?id=${encodeURIComponent(course.id)}`)
        .then(res => (res.ok ? res.json() : null))
        .then(data => {
          const full: GolfCourse | undefined = data?.course;
          if (!full || selectedCourseIdRef.current !== course.id) return;
          setSelectedCourse(full);
          applyCourseData(full);
          // Section chooser rules: a proper 18 section is fully playable
          // (no prompt); a NINE prompts for the back nine (or "just this
          // nine"); a generic club row prompts for the section.
          const club = data?.club as { id: string; name: string } | undefined;
          const siblings = (data?.siblings as SectionSibling[] | undefined) ?? [];
          const kind = full.sectionKind ?? course.sectionKind;
          // A row that is itself a named course of the club (a split club's
          // "North", not yet known to be an 18 or a nine) is a selection too.
          const namedCourse = kind !== 'nine' && !!(full.sectionName ?? course.sectionName);
          if (club && siblings.length > 0 && kind !== 'course_18' && !namedCourse) {
            if (kind === 'nine') {
              setComboFront(full);
              setSectionChoice({ club, options: siblings.filter(isNineOption) });
            } else {
              setComboFront(null);
              setSectionChoice({ club, options: siblings });
            }
          }
        })
        .catch(() => { /* thin data stands; the course is still usable */ });
    }
  }, [applyCourseData, cancelCourseSearch]);

  /** Chooser tap on a section. An 18 becomes the selection outright; a nine
   *  becomes the FRONT nine and the chooser switches to back-nine mode. */
  const applySectionSelection = useCallback(async (sib: SectionSibling) => {
    setSectionLoading(true);
    try {
      const full = await fetchFullCourse(sib.id);
      if (!full) return;
      setSelectedCourse(full);
      selectedCourseIdRef.current = full.id;
      applyCourseData(full);
      setSharedRoundDetails(prev => ({ ...prev, courseComposition: null }));
      if (isNineOption({ ...sib, sectionKind: full.sectionKind ?? sib.sectionKind })) {
        setComboFront(full);
        setSectionChoice(prev =>
          prev
            ? { ...prev, options: prev.options.filter(o => o.id !== full.id && isNineOption(o)) }
            : prev
        );
      } else {
        setSectionChoice(null);
        setComboFront(null);
      }
    } finally {
      setSectionLoading(false);
    }
  }, [applyCourseData, fetchFullCourse]);

  /** Chooser tap on the BACK nine: compose front+back into one 18-hole
   *  course (holes 1–18, WHS-combined ratings) and record the composition. */
  const applyBackNine = useCallback(async (sib: SectionSibling) => {
    const front = comboFront;
    const club = sectionChoice?.club;
    if (!front) return;
    setSectionLoading(true);
    try {
      const back = await fetchFullCourse(sib.id);
      if (!back) return;
      const composed = composeCourses(front, back, club?.name);
      setSelectedCourse(composed);
      selectedCourseIdRef.current = composed.id;
      applyCourseData(composed);
      setSharedRoundDetails(prev => ({
        ...prev,
        courseComposition: buildComposition(front, back),
      }));
      setSectionChoice(null);
      setComboFront(null);
    } finally {
      setSectionLoading(false);
    }
  }, [comboFront, sectionChoice, applyCourseData, fetchFullCourse]);

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
      stepId,
    });
  }, [
    onChange,
    stepId,
    sharedRoundDetails,
    sharedRoundParticipants,
    sharedRoundParticipantsData,
    playerScores,
    courseHoleData,
    manualParEntry,
    manualYardageEntry,
    selectedCourse,
  ]);

  // The players' handicaps for the last step (Oct 29 2026): one GET for the
  // ids not yet asked, when the finish step opens; a miss or a failure
  // simply shows no suffix. The cache lives for the section's life.
  const [handicaps, setHandicaps] = useState<Record<string, string | null>>({});
  const handicapsAskedRef = useRef<Set<string>>(new Set());
  const [handicapsWanted, setHandicapsWanted] = useState<string[]>([]);
  useEffect(() => {
    const ids = handicapsWanted.filter(id => !handicapsAskedRef.current.has(id));
    if (ids.length === 0) return;
    for (const id of ids) handicapsAskedRef.current.add(id);
    let cancelled = false;
    fetch(`/api/golf/handicaps?ids=${encodeURIComponent(ids.join(','))}`, { credentials: 'include' })
      .then(res => (res.ok ? res.json() : null))
      .then((data: { handicaps?: Record<string, string | null> } | null) => {
        if (cancelled || !data?.handicaps) return;
        setHandicaps(prev => ({ ...prev, ...data.handicaps }));
      })
      .catch(() => { /* no suffix — the list renders either way */ });
    return () => {
      cancelled = true;
    };
  }, [handicapsWanted]);

  // ── The steps (Oct 28 2026) ─────────────────────────────────────────────
  // The list follows the first step's answers (round-steps.ts); the step is
  // held by ID so a list change keeps the person where they are, and an id
  // the new list lacks starts over at the first step.
  const indoor = sharedRoundDetails.roundTypeIndoorOutdoor === 'indoor';
  const steps = stepsForRound({ alreadyPlayed: sharedRoundDetails.alreadyPlayed, indoor });
  const stepIndex = roundStepIndex(steps, stepId);
  const currentStep = steps[stepIndex];
  const refusal = roundStepRefusal(currentStep.id, {
    courseName: sharedRoundDetails.courseName,
    date: sharedRoundDetails.date,
    alreadyPlayed: sharedRoundDetails.alreadyPlayed,
  });

  // The course step's view: the picked course (or the hand-typed one, once
  // added), else the search.
  const typedCourse = sharedRoundDetails.courseName.trim();
  const courseShown = !!selectedCourse || (manualCourse && typedCourse !== '');

  useEffect(() => {
    if (!active || currentStep.id !== 'course' || recentAskedRef.current) return;
    recentAskedRef.current = true;
    let cancelled = false;
    fetch('/api/golf/courses?recent=1', { credentials: 'include' })
      .then(res => (res.ok ? res.json() : null))
      .then((body: { courses?: GolfCourse[] } | null) => {
        if (!cancelled && Array.isArray(body?.courses)) setRecentCourses(body.courses);
      })
      .catch(() => { /* a convenience list: the search works without it */ });
    return () => {
      cancelled = true;
      // StrictMode's second mount must ask again (the first was cancelled).
      recentAskedRef.current = false;
    };
  }, [active, currentStep.id]);

  // The composer's dialog follows the step (480 → 760 px on a desktop).
  const frame = roundFrame(currentStep.id, courseShown, coursePanel === 'scorecard');
  useEffect(() => {
    if (active) onFrame?.(frame);
  }, [active, frame, onFrame]);

  const setAlreadyPlayed = (alreadyPlayed: boolean) => {
    // An already-played round never carries a forecast: what was filled
    // stays as values the person now owns.
    if (alreadyPlayed) forgetForecast();
    setSharedRoundDetails(prev => ({
      ...prev,
      alreadyPlayed,
      ...(alreadyPlayed && prev.conditionsSource === 'forecast' ? { conditionsSource: 'manual' as const, conditionsAt: null } : {}),
      // A live round is dated today; the old past-date → Already played flip
      // is gone now that the first step asks outright.
      date: roundDateForMode(alreadyPlayed, prev.date, localDayKey(new Date())),
    }));
  };
  const setIndoor = (next: boolean) => {
    if (next) forgetForecast();
    setSharedRoundDetails(prev => ({
      ...prev,
      roundTypeIndoorOutdoor: next ? 'indoor' : 'outdoor',
      // Indoor has no conditions step — values entered before the switch
      // used to ride along to the server; they are cleared here.
      ...(next ? { weather: '', temperature: '', wind: '', conditionsSource: undefined, conditionsAt: null } : {}),
    }));
  };

  const wantedIds = (currentStep.id === 'finish' && active ? [userId, ...sharedRoundParticipants] : []).filter((id): id is string => !!id);
  if (wantedIds.join(',') !== handicapsWanted.join(',')) setHandicapsWanted(wantedIds);

  const courseFacts = selectedCourse ? courseSummary(selectedCourse) : { holeCount: sharedRoundDetails.holesPlayed, par: null, tees: [] };
  const teeTotals = courseFacts.tees;

  // ── The picked course's tee table, dials and rating slots ────────────────
  // The rows are the old Tees select's options: a catalog course's REAL
  // tees, the classic five colours for a map-only card or a typed course.
  const teeKeys: string[] = isMapSheet(selectedCourse?.sheetSource) ? [...FALLBACK_TEES] : courseTeeOptions(selectedCourse);
  const bothTeeSides = hasBothTeeSides(teeKeys);
  const teeSide: TeeSide = teeSideChoice ?? (isWomensTee(sharedRoundDetails.teeColor) ? 'women' : 'men');
  const teeRows: TeeTotal[] = (bothTeeSides ? splitTeeSides(teeKeys)[teeSide] : teeKeys).map(key =>
    teeTotals.find(t => t.key === key) ?? { key, label: teeLabel(key), yards: null, rating: null, slope: null }
  );
  /** A tee row's tap — the old Tees select's onChange, verbatim. */
  const pickTee = (tee: string) => {
    const course = selectedCourse;
    setSharedRoundDetails(prev => ({
      ...prev,
      teeColor: tee,
      // Re-fill THIS tee's rating/slope (the flagged follow-up from the
      // catalog round — tee changes used to leave the old tee's numbers
      // standing).
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
  };
  // Rating and slope are TYPED only where the card cannot answer; the dials
  // show them once a tee is in play (or wherever they are typed).
  const ratingTyped = ratingEntryNeeded(selectedCourse, sharedRoundDetails.teeColor);
  const ratingShown = ratingTyped || sharedRoundDetails.teeColor !== '';
  const teeYards = teeTotals.find(t => t.key === sharedRoundDetails.teeColor)?.yards ?? null;
  const mapYards = isMapSheet(selectedCourse?.sheetSource) ? teeTotals.find(t => t.key === 'map')?.yards ?? null : null;
  const dialYards = teeYards ?? mapYards;
  const dialYardsApprox = teeYards === null && mapYards !== null;

  /** "Add course manually": the typed name goes on as a custom course. */
  const addCourseManually = () => {
    cancelCourseSearch();
    setAvailableCourses([]);
    setCourseSearchOpen(false);
    setManualCourse(true);
  };
  /** The plate's "Change": back to the search. A picked catalog course is
   *  let go exactly as editing its name used to let it go; a typed name
   *  stays in the slot to be corrected. */
  const changeCourse = () => {
    setManualCourse(false);
    setTeeSideChoice(null);
    if (!selectedCourse) return;
    setSelectedCourse(null);
    selectedCourseIdRef.current = null;
    setSectionChoice(null);
    setComboFront(null);
    setCourseSearchQuery('');
    setSharedRoundDetails(prev => ({
      ...prev,
      courseName: '',
      courseId: null,
      courseComposition: null,
      holesPlayed: 18,
      // A course-specific tee name means nothing on another course —
      // keep only classic colors.
      teeColor: (FALLBACK_TEES as readonly string[]).includes(prev.teeColor) ? prev.teeColor : '',
    }));
  };
  const noCourseFound =
    courseSearchOpen && !searchLoading && !searchFailed && availableCourses.length === 0 && searchedFor === typedCourse && !selectedCourse;

  const dateField = (
    <label className="block mb-2.5" htmlFor="golf-round-date">
      <span className="ea-mech-micro block mb-2">Date</span>
      <span className="ea-mech-recess flex items-center h-12 px-3.5 rounded-[14px]">
        <input
          id="golf-round-date"
          type="date"
          value={sharedRoundDetails.date}
          max={localDayKey(new Date())}
          onChange={(e) => {
            const date = e.target.value;
            setSharedRoundDetails(prev => ({ ...prev, date }));
          }}
          className="ea-mech-slot-input w-full min-w-0 h-full text-[15px]"
        />
      </span>
    </label>
  );
  const teeInPlayTotal = teeTotals.find(t => t.key === sharedRoundDetails.teeColor);
  const teeInPlay = sharedRoundDetails.teeColor
    ? teeInPlayTotal ? teeChoiceLabel(teeInPlayTotal) : teeLabel(sharedRoundDetails.teeColor)
    : null;
  const summaryRows: { label: string; value: string | null }[] = [
    { label: 'Course', value: sharedRoundDetails.courseName.trim() || null },
    ...(sharedRoundDetails.alreadyPlayed ? [{ label: 'Date', value: sharedRoundDetails.date || null }] : []),
    { label: 'Round type', value: indoor ? 'Indoor' : 'Outdoor' },
    { label: 'Format', value: gameFormatLabel(sharedRoundDetails.gameFormat) },
    ...(!indoor ? [{ label: 'Tee', value: teeInPlay }] : []),
    // ONE line (Oct 29 2026, Tom): "Cloudy, 7°C, 5–10 mph" — the temperature
    // in the viewer's unit; "Forecast at tee-off" lives on the step's note,
    // the round card and the round page, not here.
    ...(!indoor
      ? [{
          label: 'Conditions',
          value: conditionsLine({
            weather: sharedRoundDetails.weather,
            temperature:
              sharedRoundDetails.temperature && Number.isFinite(Number(sharedRoundDetails.temperature))
                ? toDisplay('temp', fromInput('temp', Number(sharedRoundDetails.temperature), 'imperial'), unitSys)
                : null,
            unit: QUANTITY_UNITS.temp[unitSys] as '°C' | '°F',
            wind: sharedRoundDetails.wind,
          }),
        }]
      : []),
  ];
  // The players, stacked (Oct 29 2026): the creator first, then every
  // partner — picture, name, and " · index 12.4" when the handicap is known.
  const roundPlayers: { id: string; name: string; avatar_url?: string }[] = [
    ...(userId ? [{ id: userId, name: creatorName ?? 'You', avatar_url: displayProfile?.avatar_url ?? undefined }] : []),
    ...sharedRoundParticipantsData,
  ];

  return (
    <>
      {active && (
        <StepFlow
          id="golf-round"
          steps={steps}
          index={stepIndex}
          onIndex={i => setStepId(steps[i]?.id ?? FIRST_ROUND_STEP)}
          finishLabel={
            sharedRoundDetails.alreadyPlayed ? (
              <>
                <FaIcon icon={faPaperPlane} className="mr-2" />
                {roundFinishLabel(true)}
              </>
            ) : (
              <>
                <span className="inline-block w-2 h-2 bg-surface rounded-full mr-2 animate-pulse align-middle"></span>
                {roundFinishLabel(false)}
              </>
            )
          }
          finishTone={sharedRoundDetails.alreadyPlayed ? 'brand' : 'live'}
          onFinish={() => onFinish?.()}
          busy={busy}
          busyLabel={busyLabel ?? roundBusyLabel(sharedRoundDetails.alreadyPlayed)}
          canAdvance={refusal === null}
          refusal={refusal ?? undefined}
          // The mechanical dialect (Nov 23 2026): the composer wears the
          // `.ea-mech` scope while golf is the post type and hands over its
          // sport row; the frame fills the dialog, so the footer sits at
          // the bottom of a phone screen and the body scrolls above it.
          variant="mech"
          lead={lead}
          // The plate's logo is Logo.dev's: its credit sits between Back and Next.
          footerCenter={currentStep.id === 'course' && courseShown && selectedCourse && logoUrl(websiteDomain(selectedCourse.website) ?? undefined, 44)
            ? <LogoDevAttribution className="text-[11px] text-[color:var(--mech-label)]" />
            : null}
          className="flex-1 min-h-0"
        >
          {currentStep.id === 'type' && (
            <RoundTypeStep
              alreadyPlayed={sharedRoundDetails.alreadyPlayed}
              indoor={indoor}
              onAlreadyPlayed={setAlreadyPlayed}
              onIndoor={setIndoor}
              forName={activeProfile && activeProfile.id !== profile?.id ? creatorName : null}
            />
          )}

          {/* ── Step 2: the course (the mechanical dialect, Nov 23 2026) ────
              Two views of ONE step, swapped in place: the SEARCH (a slot, the
              Near me key, the lists) until a course is picked or added by
              hand, then the PICKED course (the plate, the dials, the tee
              table, the utility row). Every handler is the one-page form's;
              only what is drawn changed. */}
          {currentStep.id === 'course' && !courseShown && (
            <div ref={courseFieldRef} data-round-step="course" data-course-view="search">
              {/* Date — an already-played round's only; a live round is
                  today (set when Playing now is chosen). */}
              {sharedRoundDetails.alreadyPlayed && dateField}

              {/* The search slot and the Near me key. The slot's text IS the
                  round's course name, as the field always was: a typed name
                  may go on as a custom course. */}
              <div className="flex items-center gap-2">
                <div className="ea-mech-recess flex-1 min-w-0 flex items-center gap-2.5 h-12 px-3.5 rounded-[14px]">
                  {searchLoading ? (
                    <span className="inline-block animate-spin h-[18px] w-[18px] shrink-0 rounded-full border-2 border-[color:var(--mech-accent-light)] border-t-transparent" aria-hidden="true" />
                  ) : (
                    <FaIcon icon={faMagnifyingGlass} className="text-[18px] text-[color:var(--mech-label)]" />
                  )}
                  <input
                    type="text"
                    value={sharedRoundDetails.courseName}
                    onChange={(e) => {
                      setSharedRoundDetails(prev => ({ ...prev, courseName: e.target.value }));
                      setCourseSearchQuery(e.target.value);
                      // Typing ends the one-shot Near me: typeahead again.
                      setNearFix(null);
                      searchCourses(e.target.value);
                      setCourseSearchOpen(true);
                    }}
                    ref={courseInputRef}
                    onFocus={() => {
                      // The step's own focus-on-entry is not a tap: the field is
                      // ready to type into, the catalog list waits for a gesture.
                      if (programmaticFocusRef.current) {
                        programmaticFocusRef.current = false;
                        return;
                      }
                      setCourseSearchOpen(true);
                      // Empty input browses the catalog head — the field
                      // answers "what courses are there?" on first tap.
                      searchCourses(courseSearchQuery, { browse: true });
                    }}
                    onKeyDown={(e) => {
                      // Escape closes the LIST first and stops there — the
                      // composer's own Escape would otherwise discard the
                      // whole post. Innermost layer closes first.
                      if (e.key === 'Escape' && courseDropdownOpen) {
                        e.preventDefault();
                        e.stopPropagation();
                        closeCourseSearch();
                      }
                    }}
                    placeholder="Search courses"
                    aria-label="Course name"
                    data-course-search=""
                    className="ea-mech-slot-input flex-1 min-w-0 h-full text-[15px]"
                  />
                </div>
                {/* Near me — the ONLY place the composer asks for the
                    device's location, and only on this tap. */}
                <button
                  type="button"
                  onClick={() => void findNearMe()}
                  disabled={nearBusy}
                  aria-pressed={!!nearFix}
                  aria-label={nearBusy ? 'Finding you…' : nearFix ? 'Courses near you' : 'Near me'}
                  data-course-near-me=""
                  {...(nearFix ? { 'data-selected': '' } : {})}
                  className="ea-mech-panel ea-mech-row ea-mech-btn inline-flex items-center justify-center w-12 h-12 shrink-0 rounded-[14px] disabled:opacity-60"
                >
                  <FaIcon icon={nearBusy ? faSpinner : faLocationCrosshairs} spin={nearBusy ? true : false} className="ea-mech-icon text-[20px]" />
                </button>
              </div>
              {nearError && <p className="mt-2 text-xs text-[color:var(--mech-text-soft)]" role="alert">{nearError}</p>}

              {/* The results, in the flow (never a floating panel: nothing to
                  clip, nothing to scroll into view). */}
              {courseDropdownOpen && (
                <div className="mt-2.5">
                  <p className="ea-mech-micro mb-2">{nearFix ? 'Nearby' : 'Courses'}</p>
                  <div className="ea-mech-panel rounded-2xl overflow-hidden" data-course-results="">
                    {/* Standing on a course and about to play it: offer it
                        first. Only while starting a LIVE round — an already-
                        played round is wherever it was played. */}
                    {nearOffer && !sharedRoundDetails.alreadyPlayed && (
                      <button
                        type="button"
                        onClick={() => selectCourse(nearOffer.course)}
                        data-course-nearby-offer=""
                        data-selected=""
                        className="ea-mech-row w-full flex items-center gap-2 h-14 pl-3.5 pr-3 text-left"
                      >
                        <FaIcon icon={faLocationDot} className="ea-mech-icon text-[16px]" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-[color:var(--mech-text)]">Playing at {nearOffer.course.name}?</span>
                          <span className="block truncate text-xs text-[color:var(--mech-text-soft)]">{formatKm(nearOffer.km)}</span>
                        </span>
                        <FaIcon icon={faChevronRight} className="text-[16px] text-[color:var(--mech-chevron)]" />
                      </button>
                    )}
                    {availableCourses.map((course, i) => (
                      <CourseRow
                        key={course.id}
                        course={course}
                        showKm={!!nearFix}
                        divided={i > 0 || (!!nearOffer && !sharedRoundDetails.alreadyPlayed)}
                        onPick={selectCourse}
                      />
                    ))}
                    {searchFailed && (
                      <p className="px-3.5 py-3 text-[13px] text-[color:var(--mech-text-soft)]" style={{ borderTop: '1px solid var(--mech-divider)' }}>
                        Course search is unavailable right now — you can keep
                        typing the course name and try again in a minute.
                      </p>
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
                        data-course-worldwide=""
                        className="ea-mech-row w-full flex items-center gap-2 min-h-[44px] px-3.5 py-2 text-left text-[13px] font-medium text-[color:var(--mech-accent-light)]"
                        style={{ borderTop: '1px solid var(--mech-divider)' }}
                      >
                        <FaIcon icon={faGlobe} className="text-[16px]" />
                        <span className="min-w-0">Search all courses worldwide for &ldquo;{trimmedCourseQuery}&rdquo;</span>
                      </button>
                    )}
                    {catalogAttribution && (
                      <p className="px-3.5 py-1.5 text-[10px] leading-snug text-[color:var(--mech-label)]" style={{ borderTop: '1px solid var(--mech-divider)' }}>
                        {catalogAttribution}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Recent: the account's own last courses, until a search or a
                  Near me list takes the place. */}
              {!courseDropdownOpen && typedCourse === '' && recentCourses.length > 0 && (
                <div className="mt-2.5" data-course-recent="">
                  <p className="ea-mech-micro mb-2">Recent</p>
                  <div className="ea-mech-panel rounded-2xl overflow-hidden">
                    {recentCourses.map((course, i) => (
                      <CourseRow key={course.id} course={course} showKm={false} divided={i > 0} onPick={selectCourse} />
                    ))}
                  </div>
                </div>
              )}

              {/* A typed name is a course too: say so, and offer the way on. */}
              {typedCourse !== '' && (
                <div className="mt-4 flex flex-col items-center gap-2.5" data-course-manual="">
                  {noCourseFound && (
                    <p className="text-sm text-[color:var(--mech-text-dim)]" data-course-none="">No course found</p>
                  )}
                  <button
                    type="button"
                    onClick={addCourseManually}
                    data-course-add-manually=""
                    className="ea-mech-panel ea-mech-btn inline-flex items-center justify-center h-11 px-4 rounded-xl text-sm font-semibold text-[color:var(--mech-text)]"
                  >
                    Add course manually
                  </button>
                </div>
              )}
            </div>
          )}

          {currentStep.id === 'course' && courseShown && (
            <div data-round-step="course" data-course-view="selected">
              {sharedRoundDetails.alreadyPlayed && dateField}

              {/* Section chooser — a multi-course club prompts for the
                  course/section (and, for nines, the back nine). Backing
                  out ("keep as selected") is always available: the
                  already-applied selection stands. */}
              {sectionChoice && (
                <div className="ea-mech-panel mb-2.5 p-3 rounded-2xl" data-club-section-chooser="">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-[color:var(--mech-text)]">
                      {comboFront
                        ? `Playing 18 at ${sectionChoice.club.name}? Pick your back nine`
                        : `${sectionChoice.club.name} has more than one course — which are you playing?`}
                    </p>
                    <button
                      type="button"
                      onClick={() => { setSectionChoice(null); setComboFront(null); }}
                      className="ea-mech-btn inline-flex items-center min-h-[44px] -my-2.5 px-1 rounded-lg text-[13px] text-[color:var(--mech-text-soft)] whitespace-nowrap"
                    >
                      {comboFront ? 'Just this nine' : 'Keep as selected'}
                    </button>
                  </div>
                  {comboFront && (
                    <p className="mt-1 text-xs text-[color:var(--mech-text-soft)]">
                      {comboFront.sectionName ?? comboFront.name} is your front nine (holes 1–9);
                      the nine you pick next scores as holes 10–18.
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {sectionChoice.options.map(option => (
                      <button
                        key={option.id}
                        type="button"
                        disabled={sectionLoading}
                        onClick={() => (comboFront ? applyBackNine(option) : applySectionSelection(option))}
                        data-club-section-option={option.id}
                        className="ea-mech-recess ea-mech-btn px-3 min-h-[44px] rounded-xl text-sm font-medium text-[color:var(--mech-text)] disabled:opacity-50"
                      >
                        {option.sectionName ?? option.name}
                        {(isNineOption(option) || option.sectionKind === 'course_18' || option.holesCount === 18) && (
                          <span className="ml-1.5 text-xs text-[color:var(--mech-text-soft)]">
                            {isNineOption(option) ? '9 holes' : '18 holes'}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                  {sectionLoading && (
                    <p className="mt-2 text-xs text-[color:var(--mech-text-soft)]">Loading course…</p>
                  )}
                </div>
              )}

              {/* A phone reads top to bottom: plate, dials, tees, utility row.
                  From 640 px the same four are two columns — plate, dials and
                  utility row on the left, the tees on the right; an open map
                  or scorecard takes the full width under both. */}
              <div className="flex flex-col gap-2.5 sm:grid sm:grid-cols-2 sm:gap-x-4 sm:items-start">
                <div className="sm:col-start-1 sm:row-start-1">
                  <CoursePlate
                    name={selectedCourse?.name ?? typedCourse}
                    place={selectedCourse
                      ? formatPlace({ city: selectedCourse.city, region: selectedCourse.state, country: selectedCourse.country }) || null
                      : 'Custom course'}
                    logoDomain={selectedCourse ? websiteDomain(selectedCourse.website) : null}
                    onChange={changeCourse}
                  />
                </div>

                <div className="sm:col-start-1 sm:row-start-2">
                  <DialCluster
                    holes={courseFacts.holeCount}
                    par={courseFacts.par}
                    parEstimated={selectedCourse?.sheetSource === 'map_estimated'}
                    yards={dialYards}
                    yardsApprox={dialYardsApprox}
                    rating={ratingShown ? dialValue(sharedRoundDetails.courseRating) : null}
                    slope={ratingShown ? dialValue(sharedRoundDetails.slopeRating) : null}
                  />
                </div>

                <div className="flex flex-col gap-2.5 sm:col-start-2 sm:row-start-1 sm:row-span-3">
                  {/* Tees (outdoor only) — a catalog course lists its REAL
                      tees (hardest first); picking one re-fills that tee's
                      exact rating/slope and per-hole yardages. Custom and
                      history courses keep the classic five colours. */}
                  {sharedRoundDetails.roundTypeIndoorOutdoor === 'outdoor' && (
                    <>
                      {bothTeeSides && (
                        <div className="flex items-center h-[50px]">
                          <KeySwitch
                            size="sm"
                            light
                            label="Tees for"
                            options={TEE_SIDE_OPTIONS}
                            value={teeSide}
                            onChange={setTeeSideChoice}
                            keyClassName="w-[86px]"
                          />
                        </div>
                      )}
                      <TeeTable tees={teeRows} value={sharedRoundDetails.teeColor} onPick={pickTee} />
                    </>
                  )}

                  {/* Course rating & slope — the key that unlocks the
                      computed handicap. Typed only where the card cannot
                      answer (tees.ts ratingEntryNeeded): a course typed by
                      hand, an unrated row, a tee without its numbers. */}
                  {ratingTyped && (
                    <div className="grid grid-cols-2 gap-2" data-course-rating-entry="">
                      <label className="block">
                        <span className="ea-mech-micro block mb-2">Course rating</span>
                        <span className="ea-mech-recess flex items-center h-12 px-3.5 rounded-[14px]">
                          <input
                            type="number"
                            step="0.1"
                            min="50"
                            max="90"
                            inputMode="decimal"
                            value={sharedRoundDetails.courseRating}
                            onChange={(e) => setSharedRoundDetails(prev => ({ ...prev, courseRating: e.target.value }))}
                            placeholder="72.4"
                            className="ea-mech-slot-input ea-mech-readout w-full min-w-0 h-full text-[15px]"
                          />
                        </span>
                      </label>
                      <label className="block">
                        <span className="ea-mech-micro block mb-2">Slope rating</span>
                        <span className="ea-mech-recess flex items-center h-12 px-3.5 rounded-[14px]">
                          <input
                            type="number"
                            min="55"
                            max="155"
                            inputMode="numeric"
                            value={sharedRoundDetails.slopeRating}
                            onChange={(e) => setSharedRoundDetails(prev => ({ ...prev, slopeRating: e.target.value }))}
                            placeholder="128"
                            className="ea-mech-slot-input ea-mech-readout w-full min-w-0 h-full text-[15px]"
                          />
                        </span>
                      </label>
                    </div>
                  )}
                </div>

                {/* Keyed: a course swap remounts the card (and its Leaflet
                    map) cleanly instead of re-using one instance's state. */}
                {selectedCourse && (
                  <CourseInfoCard
                    key={selectedCourse.id}
                    course={selectedCourse}
                    teeInPlay={sharedRoundDetails.teeColor}
                    autoFindSheet
                    variant="mech"
                    className="min-w-0 sm:col-start-1 sm:row-start-3"
                    openClassName="sm:!col-span-2 sm:!row-start-4"
                    onPanelChange={setCoursePanel}
                    // "Find the official scorecard" found one: the selection takes
                    // the fuller row so the round's pars, tees and ratings follow.
                    onCourseUpdated={full => {
                      setSelectedCourse(full);
                      selectedCourseIdRef.current = full.id;
                      applyCourseData(full);
                    }}
                    // The lookup found the club is several courses (Nov 19 2026):
                    // the same question a club already split asks on selection.
                    onClubFound={(club, sections) => {
                      if (selectedCourseIdRef.current !== selectedCourse.id) return;
                      setComboFront(null);
                      setSectionChoice({ club, options: sections });
                    }}
                  />
                )}
              </div>

          {/* Manual Par & Yardage Entry (when course not in database) */}
          {!selectedCourse && sharedRoundDetails.courseName && (
            <div className={`${GOLF_SECTION_CARD} mt-2.5`}>
              <SectionInfo
                as="h3"
                heading={<><FaIcon icon={faPenToSquare} className="mr-2 text-brand-fg" />Course Par & Yardage (Optional)</>}
                label="course par and yardage"
                headingClassName="text-lg font-semibold text-primary flex items-center"
                className="mb-4"
              >
                <p>Entering par and yardage will display these values in the scorecard.</p>
              </SectionInfo>
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

              </div>
            </div>
          )}
            </div>
          )}

          {currentStep.id === 'format' && (
            <div className={GOLF_SECTION_CARD}>
              <FormatStep
                value={sharedRoundDetails.gameFormat}
                onChange={gameFormat => setSharedRoundDetails(prev => ({ ...prev, gameFormat }))}
              />
            </div>
          )}

          {currentStep.id === 'conditions' && (
            <div className={GOLF_SECTION_CARD}>
              <ConditionsStep
                value={{ weather: sharedRoundDetails.weather, temperature: sharedRoundDetails.temperature, wind: sharedRoundDetails.wind }}
                onChange={patch => {
                  // A typed value is the person's: the forecast line steps aside.
                  setForecastFilled(null);
                  setSharedRoundDetails(prev => ({ ...prev, ...patch, conditionsSource: 'manual', conditionsAt: null }));
                }}
                sys={unitSys}
                onUnit={next => { void setUnitSys(next); }}
                forecast={
                  !sharedRoundDetails.alreadyPlayed && selectedCourse?.lat != null && selectedCourse?.lng != null
                    ? { status: forecastStatus, onUse: () => { void fillFromForecast(); }, filled: forecastFilled }
                    : undefined
                }
              />
            </div>
          )}

          {currentStep.id === 'players' && (
            <div data-round-step="players">
          <div className={GOLF_SECTION_CARD}>
            <SectionInfo
              as="h3"
              heading={sharedRoundDetails.alreadyPlayed ? 'Round Participants' : 'Playing Partners'}
              headingClassName="text-lg font-semibold text-primary flex items-center"
              className="mb-4"
            >
              <p>
                {sharedRoundDetails.alreadyPlayed
                  ? 'You’re on the scorecard already — add playing partners if you weren’t alone.'
                  : 'Playing solo — just hit Go Live. Add partners any time if someone joins you.'}
              </p>
            </SectionInfo>
            <div>
              {/* flex-wrap: the label is long and dynamic — at ~279px of
                  card width it must wrap rather than squeeze the button. */}
              <div className="flex flex-wrap items-center justify-end gap-2 mb-3">
                <div className="flex items-center gap-2">
                  {/* The old "+ Add Myself" button (already-played only) is
                      gone: the creator's row is always seeded and the
                      server always inserts the creator — it only implied
                      partners were required. */}
                  <button
                    type="button"
                    onClick={() => setShowParticipantModal(true)}
                    className="ea-cta flex min-h-[44px] items-center gap-2 px-4 text-sm text-white rounded-lg font-semibold"
                    data-round-add-players=""
                  >
                    <FaIcon icon={faUserPlus} />
                    Add Others
                  </button>
                </div>
              </div>

              {/* The added players, one row each (Oct 29 2026): the picture
                  the search showed, the name, Remove — on the house light
                  purple. */}
              {sharedRoundParticipantsData.length > 0 ? (
                <ul className="space-y-2" data-round-partners="">
                  {sharedRoundParticipantsData.map(participant => (
                    <li
                      key={participant.id}
                      data-round-partner={participant.id}
                      className="flex items-center gap-3 rounded-lg border border-violet-200 dark:border-violet-800 bg-brand-soft px-3 py-2 text-sm"
                    >
                      <AvatarImage src={participant.avatar_url} alt="" size={32} fallbackInitials={getInitials(participant.name)} />
                      <span className="flex-1 min-w-0 truncate font-medium text-primary">{participant.name}</span>
                      <button
                        type="button"
                        onClick={() => removeParticipant(participant.id)}
                        className="ea-icon-btn text-secondary hover:text-primary"
                        aria-label={`Remove ${participant.name}`}
                      >
                        <FaIcon icon={faXmark} className="text-xs" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
            </div>
          )}

          {/* Scores — the already-played round's one-pass entry: the grid and
              the hole-by-hole Quick entry, as the one-page form had them. A
              live round has no scores step; they are entered on the live page. */}
          {currentStep.id === 'scores' && (
            <div data-round-step="scores">
          <div ref={scoreInfoRef} className={GOLF_SECTION_CARD}>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <div className="flex items-center gap-1">
                <h3 className="text-lg font-semibold text-primary flex items-center">
                  <FaIcon icon={faListOl} className="mr-2 text-green-600 dark:text-green-400" />
                  Score Entry
                </h3>
                <InfoButton d={scoreInfo} />
              </div>
              {/* One-tap path into the hole-by-hole stepper (ScoreEntryModal
                  in batch mode) — the phone-first alternative to the full
                  grid. The seam (quickEntryRequest) existed in the grid all
                  along; this is its first headline entry point: before this,
                  the stepper was reachable only through the per-cell
                  penalties badge. */}
              {/* grow + justify-center: when the flex-wrap header wraps
                  (font scaling, 320px), the button becomes a full-width
                  centered CTA instead of a stray left-aligned link. */}
              <button
                type="button"
                onClick={() => setQuickEntryRequest(n => n + 1)}
                disabled={playerScores.length === 0}
                className="ea-interactive inline-flex min-h-[44px] items-center justify-center gap-2 whitespace-nowrap grow sm:grow-0 rounded-lg border border-border-strong px-3 py-2 text-sm font-semibold text-primary disabled:opacity-50"
              >
                <FaIcon icon={faBolt} className="text-amber-500" />
                Quick entry
              </button>
            </div>
            <InfoPanel d={scoreInfo} className="mb-4">
              {sharedRoundDetails.alreadyPlayed ? 'Enter the finished round below — the post publishes once, complete. Quick entry walks it hole by hole.' : 'Enter scores now or skip — you can keep scoring hole by hole once the round is live.'}
            </InfoPanel>

            {/* Multi-player scorecard grid */}
            <div>
              <MultiPlayerScorecardGrid
                  players={playerScores}
                  holes={sharedRoundDetails.holesPlayed}
                  startingHoleNumber={startingHoleNum}
                  courseName={sharedRoundDetails.courseName || undefined}
                  editable={true}
                  showDetailedStats={false}
                  quickEntryRequest={quickEntryRequest}
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
          )}

          {currentStep.id === 'finish' && (
            <div className="space-y-6" data-round-step="finish">
              <div className={GOLF_SECTION_CARD}>
                <h3 className="text-lg font-semibold text-primary mb-3 flex items-center">
                  <FaIcon icon={sharedRoundDetails.alreadyPlayed ? faFlagCheckered : faCircleDot} className={`mr-2 ${sharedRoundDetails.alreadyPlayed ? 'text-green-600 dark:text-green-400' : 'text-red-600'}`} />
                  {sharedRoundDetails.alreadyPlayed ? 'Your round' : 'Ready to go live'}
                </h3>
                <dl className="divide-y divide-border-subtle" data-round-summary="">
                  {summaryRows.map(row => (
                    <div key={row.label} className="flex items-baseline justify-between gap-3 py-2 text-sm" data-round-summary-row={row.label.toLowerCase().replace(/\s+/g, '-')}>
                      <dt className="text-secondary">{row.label}</dt>
                      <dd className={`text-right ${row.value ? 'font-semibold text-primary' : 'text-faint'}`}>{row.value ?? 'Not set'}</dd>
                    </div>
                  ))}
                </dl>
                <div className="border-t border-border-subtle pt-2 text-sm" data-round-summary-row="players">
                  <p className="text-secondary mb-1.5">Players</p>
                  <ul className="space-y-1.5">
                    {roundPlayers.map(p => (
                      <li key={p.id} data-round-player={p.id} className="flex items-center gap-2">
                        <AvatarImage src={p.avatar_url} alt="" size={32} fallbackInitials={getInitials(p.name)} />
                        <span className="font-semibold text-primary truncate">
                          {p.name}
                          {handicaps[p.id] ? <span className="font-normal text-secondary">{handicapSuffix(handicaps[p.id])}</span> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                <p className="mt-3 text-sm text-tertiary">
                  {sharedRoundDetails.alreadyPlayed
                    ? 'Create Post saves the round and opens it for review — you post it from there.'
                    : 'Go Live opens the round — score hole by hole as you play; add partners any time.'}
                </p>
              </div>

              {/* The story: caption + media belong to an already-played
                  round's post (a live round tells its story at the finish). */}
              {sharedRoundDetails.alreadyPlayed && finishSlot}

              {onPreview && (
                <button
                  type="button"
                  onClick={onPreview}
                  disabled={refusal !== null}
                  className="ea-interactive inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-border-strong px-4 py-2 text-sm font-semibold text-primary disabled:opacity-50"
                  data-round-preview=""
                >
                  <FaIcon icon={faEye} />
                  Preview
                </button>
              )}
            </div>
          )}
        </StepFlow>
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
