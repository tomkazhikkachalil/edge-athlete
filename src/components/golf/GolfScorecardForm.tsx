'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import MultiPlayerScorecardGrid, { type PlayerHoleScore, type PlayerScoreData } from '@/components/golf/MultiPlayerScorecardGrid';
import { useToast } from '@/components/Toast';
import { useDebouncedCallback } from '@/hooks/useDebouncedCallback';
import { useAuth } from '@/lib/auth';
import type { GolfCourse } from '@/lib/golf-courses-db';
import { holeDataToPlayerScores, applyPlayerScoreChange } from '@/lib/golf/hole-adapters';
import { buildDefaultHoles } from '@/lib/golf/scoring';
import type { HoleData } from '@/types/golf';
import { GOLF_INPUT, GOLF_SELECT, GOLF_LABEL } from '@/components/golf/golf-form-styles';

// Tee box options
const TEE_OPTIONS = [
  { value: 'black', label: 'Black/Tips', color: 'bg-black' },
  { value: 'blue', label: 'Blue', color: 'bg-violet-600' },
  { value: 'white', label: 'White', color: 'bg-surface border-border-strong' },
  { value: 'gold', label: 'Gold/Senior', color: 'bg-yellow-500' },
  { value: 'red', label: 'Red/Forward', color: 'bg-red-600' }
];

interface GolfRoundData {
  date: string;
  courseName: string;
  courseLocation?: string;
  coursePar: number;
  courseRating?: number;
  courseSlope?: number;
  teeBox: string;
  holes: number;  // Flexible number of holes (not just 9 or 18)
  roundType: 'outdoor' | 'indoor';  // Indoor or outdoor golf
  startingHole: 'front' | 'back';  // For 9-hole rounds
  weather?: string;
  temperature?: number;
  wind?: string;
  playingPartners?: string;
  handicap?: number;
  holesData: HoleData[];
}

interface GolfScorecardFormProps {
  onDataChange: (data: GolfRoundData) => void;
}

export default function GolfScorecardForm({ onDataChange }: GolfScorecardFormProps) {
  const { showSuccess } = useToast();
  // Sticky player column identity for the (single-row) shared grid — the
  // athlete this round belongs to. activeProfile covers acting-as contexts.
  const { profile, activeProfile } = useAuth();
  const displayProfile = activeProfile ?? profile;

  // Course info
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [courseName, setCourseName] = useState('');
  const [courseLocation, setCourseLocation] = useState('');
  const [coursePar, setCoursePar] = useState(72);
  const [courseRating, setCourseRating] = useState<number | undefined>();
  const [courseSlope, setCourseSlope] = useState<number | undefined>();
  const [teeBox, setTeeBox] = useState('white');
  const [holeCount, setHoleCount] = useState<number>(18);
  const [roundType, setRoundType] = useState<'outdoor' | 'indoor'>('outdoor');
  const [startingHole, setStartingHole] = useState<'front' | 'back'>('front'); // 9-hole rounds: front (1-9) or back (10-18)

  // Round conditions
  const [weather, setWeather] = useState('');
  const [temperature, setTemperature] = useState<number | undefined>();
  const [wind, setWind] = useState('');
  const [playingPartners, setPlayingPartners] = useState('');
  const [handicap, setHandicap] = useState<number | undefined>();

  // Scorecard data — seeded with the default grid ON MOUNT. Starting empty
  // and relying on the change-guarded sync below left a manually-typed course
  // at the default 18 holes with zero score cells (and quick-entry silently
  // discarding scores into the empty array).
  const [holesData, setHolesData] = useState<HoleData[]>(() => buildDefaultHoles(18, 'front'));
  // The quick-entry stepper is mounted by MultiPlayerScorecardGrid (one modal
  // path for solo + shared); the header "Quick entry" button lifts its request
  // into the grid via this counter — each increment opens it in resume mode.
  const [quickEntryRequest, setQuickEntryRequest] = useState(0);

  // Course search
  const [courseSearchOpen, setCourseSearchOpen] = useState(false);
  const courseDropdownRef = useRef<HTMLDivElement>(null);
  const [courseSearchQuery, setCourseSearchQuery] = useState('');
  const [availableCourses, setAvailableCourses] = useState<GolfCourse[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState<GolfCourse | null>(null);

  // Switch between 18- and 9-hole rounds. Adjusts the default course par
  // (72 <-> 36) only when the current value IS the other mode's default, so a
  // custom par the user typed is never stomped. (Front/Back tab state lives in
  // MultiPlayerScorecardGrid now.)
  const handleHoleCountChange = (count: number) => {
    setHoleCount(count);
    if (count === 9 && coursePar === 72) setCoursePar(36);
    if (count === 18 && coursePar === 36) setCoursePar(72);
  };

  // Rebuild the hole grid when holeCount/startingHole CHANGE (render-phase
  // sync, not an effect — the previous grid never paints for a frame). The
  // guard is deliberately false on mount: the useState initializer above
  // already built the same default grid, so this owns transitions only.
  const [syncedHoles, setSyncedHoles] = useState({ holeCount, startingHole });
  if (syncedHoles.holeCount !== holeCount || syncedHoles.startingHole !== startingHole) {
    setSyncedHoles({ holeCount, startingHole });
    setHolesData(buildDefaultHoles(holeCount, startingHole));
  }


  // Search for golf courses. Debounced + abortable: this is called straight
  // out of the input's onChange, so undebounced it fired one request per
  // keystroke. Suggestions now start at 1 character (migration 087 indexed
  // golf_rounds.course).
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
        console.error('Failed to search golf courses (scorecard) — status:', response.status);
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      console.error('Failed to search golf courses (scorecard):', e);
      setAvailableCourses([]);
    } finally {
      if (!signal.aborted) setSearchLoading(false);
    }
  }, []);

  const [debouncedCourseSearch, cancelCourseSearch] = useDebouncedCallback(runCourseSearch);

  // Same clipping fix as the shared-round field and AddEquipmentModal: this
  // dropdown is `absolute` inside the composer's `overflow-y-auto` body, so it
  // is cut off at that ancestor's edge rather than overflowing it. No-op when
  // already fully visible.
  const courseDropdownOpen = courseSearchOpen && (searchLoading || availableCourses.length > 0);
  useEffect(() => {
    if (!courseDropdownOpen) return;
    // rAF: the panel must be laid out before it can be measured.
    const id = requestAnimationFrame(() =>
      courseDropdownRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    );
    return () => cancelAnimationFrame(id);
  }, [courseDropdownOpen, availableCourses.length]);


  const searchCourses = useCallback((query: string) => {
    if (query.trim().length < 1) {
      // CANCEL, don't just return: an armed timer would still fire and refill
      // the list the user just cleared.
      cancelCourseSearch();
      setAvailableCourses([]);
      return;
    }
    debouncedCourseSearch(query.trim());
  }, [debouncedCourseSearch, cancelCourseSearch]);

  // Auto-populate course data when a course is selected
  const selectCourse = useCallback((course: GolfCourse, selectedTee: string = teeBox) => {
    setSelectedCourse(course);
    setCourseName(course.name);
    setCourseLocation(`${course.location.city}, ${course.location.state}`);
    setCoursePar(course.totalPar);

    // Set rating and slope for selected tee
    const teeKey = selectedTee as keyof typeof course.courseRating;
    setCourseRating(course.courseRating[teeKey]);
    setCourseSlope(course.slopeRating[teeKey]);

    // Auto-populate hole data with real yardages
    const numHoles = holeCount;
    const startHole = holeCount === 9 && startingHole === 'back' ? 10 : 1;
    const endHole = startHole + numHoles - 1;

    const courseHoles = course.holes.filter(h => h.number >= startHole && h.number <= endHole);

    if (courseHoles.length > 0) {
      const newHolesData: HoleData[] = courseHoles.map(hole => ({
        hole: hole.number,
        par: hole.par,
        yardage: hole.yardage[teeKey] || hole.yardage.white || 400,
        fairway: hole.par === 3 ? 'na' : undefined,
        notes: hole.description
      }));

      setHolesData(newHolesData);
      showSuccess(`Loaded ${course.name} course data!`);
    }

    setCourseSearchOpen(false);
    setCourseSearchQuery('');
  }, [holeCount, startingHole, teeBox, showSuccess]);

  // Course rating/slope/yardages are all functions of the selected course and
  // tee box, so derive them during render rather than a frame later.
  const [syncedTee, setSyncedTee] = useState({ selectedCourse, teeBox });
  if (syncedTee.selectedCourse !== selectedCourse || syncedTee.teeBox !== teeBox) {
    setSyncedTee({ selectedCourse, teeBox });
    if (selectedCourse) {
      const teeKey = teeBox as keyof typeof selectedCourse.courseRating;
      setCourseRating(selectedCourse.courseRating[teeKey]);
      setCourseSlope(selectedCourse.slopeRating[teeKey]);

      // Update hole yardages
      setHolesData(prev => prev.map(hole => {
        const courseHole = selectedCourse.holes.find(h => h.number === hole.hole);
        if (courseHole) {
          return {
            ...hole,
            yardage: courseHole.yardage[teeKey] || courseHole.yardage.white || hole.yardage
          };
        }
        return hole;
      }));
    }
  }

  // Calculate statistics (memoized)
  const stats = useMemo(() => {
    const playedHoles = holesData.filter(h => h.score !== undefined);
    if (playedHoles.length === 0) return null;

    const totalScore = playedHoles.reduce((sum, h) => sum + (h.score || 0), 0);
    const totalPar = playedHoles.reduce((sum, h) => sum + h.par, 0);
    const totalPutts = playedHoles.reduce((sum, h) => sum + (h.putts || 0), 0);

    // Fairways (exclude par 3s)
    const fairwayHoles = playedHoles.filter(h => h.par > 3);
    const fairwaysHit = fairwayHoles.filter(h => h.fairway === 'hit').length;
    const fairwayPercentage = fairwayHoles.length > 0
      ? Math.round((fairwaysHit / fairwayHoles.length) * 100)
      : 0;

    // GIR
    const greensInRegulation = playedHoles.filter(h => h.gir).length;
    const girPercentage = Math.round((greensInRegulation / playedHoles.length) * 100);

    // Scoring
    const eagles = playedHoles.filter(h => h.score && h.score <= h.par - 2).length;
    const birdies = playedHoles.filter(h => h.score === h.par - 1).length;
    const pars = playedHoles.filter(h => h.score === h.par).length;
    const bogeys = playedHoles.filter(h => h.score === h.par + 1).length;
    const doublePlus = playedHoles.filter(h => h.score && h.score >= h.par + 2).length;

    const differential = totalScore - totalPar;
    const netScore = handicap ? totalScore - handicap : undefined;

    return {
      holesPlayed: playedHoles.length,
      totalScore,
      totalPar,
      differential: differential >= 0 ? `+${differential}` : `${differential}`,
      netScore,
      totalPutts,
      puttsPerHole: (totalPutts / playedHoles.length).toFixed(1),
      fairwaysHit,
      fairwayPercentage,
      greensInRegulation,
      girPercentage,
      eagles,
      birdies,
      pars,
      bogeys,
      doublePlus
    };
  }, [holesData, handicap]);

  // ── Scorecard convergence: the entry grid is MultiPlayerScorecardGrid
  // (one player row), identical to shared rounds. holesData stays the form's
  // source of truth and the /api/posts contract; the adapters convert at the
  // UI boundary only (src/lib/golf/hole-adapters.ts).
  const startingHoleNumber = holeCount === 9 && startingHole === 'back' ? 10 : 1;

  const soloPlayers = useMemo<PlayerScoreData[]>(() => [{
    ...holeDataToPlayerScores(holesData, 'solo'),
    profile: {
      id: displayProfile?.id ?? 'solo',
      first_name: displayProfile?.first_name,
      last_name: displayProfile?.last_name,
      full_name: displayProfile?.full_name
        ?? (displayProfile?.first_name || displayProfile?.last_name ? undefined : 'You'),
      avatar_url: displayProfile?.avatar_url,
    },
  }], [holesData, displayProfile]);

  const gridHoleData = useMemo(
    () => holesData
      .filter(h => typeof h.hole === 'number')
      .map(h => ({ hole: h.hole as number, par: h.par, yardage: h.yardage })),
    [holesData]
  );

  // Write-back from the grid (checkbox/input edits AND the quick-entry
  // stepper's per-hole batch). Functional update: batched patches accumulate.
  const handleGridScoreChange = useCallback(
    (_playerId: string, holeNum: number, patch: Partial<PlayerHoleScore>) => {
      setHolesData(prev => applyPlayerScoreChange(prev, holeNum, patch));
    },
    []
  );


  // Notify parent of data changes (with stable callback)
  useEffect(() => {
    const roundData: GolfRoundData = {
      date,
      courseName,
      courseLocation,
      coursePar,
      courseRating,
      courseSlope,
      teeBox,
      holes: holeCount,
      roundType,
      startingHole,
      weather,
      temperature,
      wind,
      playingPartners,
      handicap,
      holesData
    };

    onDataChange(roundData);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, courseName, courseLocation, coursePar, courseRating, courseSlope,
      teeBox, holeCount, roundType, startingHole, weather, temperature, wind,
      playingPartners, handicap, holesData]);

  return (
    <div className="space-y-6">
      {/* Course Information */}
      <div className="bg-surface rounded-lg border border-border p-4">
        <h3 className="text-lg font-semibold text-primary mb-4 flex items-center">
          <i className="fas fa-golf-ball mr-2 text-green-600 dark:text-green-400"></i>
          Course Information
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Date */}
          <div>
            <label className={GOLF_LABEL}>Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={GOLF_INPUT}
            />
          </div>

          {/* Enhanced Course Search */}
          <div className="relative">
            <label className={GOLF_LABEL}>
              Course Name
              {selectedCourse && (
                <span className="ml-2 text-xs text-green-600 dark:text-green-400">
                  <i className="fas fa-check-circle mr-1"></i>
                  Course data loaded
                </span>
              )}
            </label>
            <input
              type="text"
              value={courseName}
              onChange={(e) => {
                setCourseName(e.target.value);
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
              onBlur={() => {
                // Delay closing to allow click on suggestions
                setTimeout(() => setCourseSearchOpen(false), 200);
              }}
              placeholder="Search famous courses (e.g., Pebble Beach, Augusta)"
              className={`${GOLF_INPUT} transition-colors ${
                selectedCourse ? 'border-green-500 bg-green-50 dark:bg-green-950/40' : ''
              }`}
            />

            {/* Enhanced course suggestions dropdown */}
            {courseDropdownOpen && (
              <div
                ref={courseDropdownRef}
                className="absolute z-10 w-full mt-1 bg-surface-raised border border-border-strong rounded-lg shadow-lg max-h-64 overflow-y-auto overscroll-contain"
              >
                {searchLoading ? (
                  <div className="px-3 py-4 text-center text-muted">
                    <i className="fas fa-spinner fa-spin mr-2"></i>
                    Searching courses...
                  </div>
                ) : (
                  availableCourses.map(course => (
                    <button
                      key={course.id}
                      onClick={() => selectCourse(course)}
                      className="w-full px-4 py-3 text-left hover:bg-green-50 dark:hover:bg-green-950/40 border-b border-border-subtle transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="font-medium text-primary">{course.name}</div>
                          <div className="text-sm text-tertiary mt-1">
                            {course.location.city}, {course.location.state}
                            {course.designer && ` • ${course.designer}`}
                          </div>
                          <div className="flex items-center gap-4 text-xs text-muted mt-1">
                            <span>Par {course.totalPar}</span>
                            {course.courseRating.black && (
                              <span>Rating: {course.courseRating.black}</span>
                            )}
                            {course.totalYardage.black && (
                              <span>{course.totalYardage.black} yards</span>
                            )}
                            {course.yearOpened && (
                              <span>Est. {course.yearOpened}</span>
                            )}
                          </div>
                        </div>
                        {course.features && course.features.length > 0 && (
                          <div className="ml-2 flex flex-wrap gap-1">
                            {course.features.slice(0, 2).map(feature => (
                              <span
                                key={feature}
                                className="px-1.5 py-0.5 bg-violet-100 dark:bg-violet-950/60 text-brand-fg-strong text-xs rounded"
                              >
                                {feature}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </button>
                  ))
                )}
              </div>
            )}

            {courseSearchQuery.length >= 2 && !searchLoading && availableCourses.length === 0 && courseSearchOpen && (
              <div className="absolute z-10 w-full mt-1 bg-surface-raised border border-border-strong rounded-lg shadow-lg">
                <div className="px-4 py-3 text-center text-muted">
                  <i className="fas fa-search mr-2"></i>
                  No courses found. Try &quot;Pebble Beach&quot; or &quot;Augusta&quot;
                </div>
              </div>
            )}
          </div>

          {/* Location */}
          <div>
            <label className={GOLF_LABEL}>Location</label>
            <input
              type="text"
              value={courseLocation}
              onChange={(e) => setCourseLocation(e.target.value)}
              placeholder="City, State"
              className={GOLF_INPUT}
            />
          </div>

          {/* Tee Box */}
          <div>
            <label className={GOLF_LABEL}>Tee Box</label>
            <select
              value={teeBox}
              onChange={(e) => setTeeBox(e.target.value)}
              className={GOLF_SELECT}
            >
              {TEE_OPTIONS.map(tee => (
                <option key={tee.value} value={tee.value}>
                  {tee.label}
                </option>
              ))}
            </select>
          </div>

          {/* Holes: 18 or 9 (front/back) */}
          <div>
            <label className={GOLF_LABEL}>
              Holes
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex gap-2">
                {[18, 9].map(count => (
                  <button
                    key={count}
                    type="button"
                    onClick={() => handleHoleCountChange(count)}
                    className={`px-4 py-2 min-h-[44px] rounded-md text-sm font-medium transition-colors ${
                      holeCount === count
                        ? 'bg-green-600 text-white'
                        : 'bg-surface-sunken text-secondary hover:bg-border'
                    }`}
                  >
                    {count} holes
                  </button>
                ))}
              </div>
              {holeCount === 9 && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setStartingHole('front')}
                    className={`px-3 py-2 min-h-[44px] rounded-md text-xs font-medium transition-colors ${
                      startingHole === 'front'
                        ? 'bg-brand text-white'
                        : 'bg-surface-sunken text-secondary hover:bg-border'
                    }`}
                  >
                    Front 9 (1–9)
                  </button>
                  <button
                    type="button"
                    onClick={() => setStartingHole('back')}
                    className={`px-3 py-2 min-h-[44px] rounded-md text-xs font-medium transition-colors ${
                      startingHole === 'back'
                        ? 'bg-brand text-white'
                        : 'bg-surface-sunken text-secondary hover:bg-border'
                    }`}
                  >
                    Back 9 (10–18)
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Round Type - Indoor/Outdoor */}
          <div>
            <label className={GOLF_LABEL}>
              Round Type
            </label>
            <div className="flex gap-4">
              <label className="flex items-center text-sm font-medium text-primary cursor-pointer">
                <input
                  type="radio"
                  value="outdoor"
                  checked={roundType === 'outdoor'}
                  onChange={(e) => setRoundType(e.target.value as 'outdoor')}
                  className="mr-2"
                />
                <i className="fas fa-tree mr-1 text-green-600 dark:text-green-400"></i>
                Outdoor
              </label>
              <label className="flex items-center text-sm font-medium text-primary cursor-pointer">
                <input
                  type="radio"
                  value="indoor"
                  checked={roundType === 'indoor'}
                  onChange={(e) => setRoundType(e.target.value as 'indoor')}
                  className="mr-2"
                />
                <i className="fas fa-warehouse mr-1 text-brand-fg"></i>
                Indoor (Simulator/Range)
              </label>
            </div>
          </div>

          {/* Course Rating/Slope */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className={GOLF_LABEL}>Par</label>
              <input
                type="number"
                value={coursePar}
                onChange={(e) => setCoursePar(Number(e.target.value))}
                className={GOLF_INPUT}
              />
            </div>
            <div>
              <label className={GOLF_LABEL}>Rating</label>
              <input
                type="number"
                step="0.1"
                value={courseRating || ''}
                onChange={(e) => setCourseRating(e.target.value ? Number(e.target.value) : undefined)}
                placeholder="72.5"
                className={GOLF_INPUT}
              />
            </div>
            <div>
              <label className={GOLF_LABEL}>Slope</label>
              <input
                type="number"
                value={courseSlope || ''}
                onChange={(e) => setCourseSlope(e.target.value ? Number(e.target.value) : undefined)}
                placeholder="130"
                className={GOLF_INPUT}
              />
            </div>
          </div>

          {/* Handicap */}
          <div>
            <label className={GOLF_LABEL}>Your Handicap</label>
            <input
              type="number"
              value={handicap || ''}
              onChange={(e) => setHandicap(e.target.value ? Number(e.target.value) : undefined)}
              placeholder="Enter handicap (optional)"
              className={GOLF_INPUT}
            />
          </div>
        </div>
      </div>

      {/* Playing Conditions - Only show for outdoor rounds */}
      {roundType === 'outdoor' && (
        <div className="bg-surface rounded-lg border border-border p-4">
          <h3 className="text-lg font-semibold text-primary mb-4 flex items-center">
            <i className="fas fa-cloud-sun mr-2 text-violet-500"></i>
            Playing Conditions
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className={GOLF_LABEL}>Weather</label>
              <select
                value={weather}
                onChange={(e) => setWeather(e.target.value)}
                className={GOLF_SELECT}
              >
                <option value="">Select...</option>
                <option value="sunny">☀️ Sunny</option>
                <option value="partly-cloudy">⛅ Partly Cloudy</option>
                <option value="cloudy">☁️ Cloudy</option>
                <option value="rainy">🌧️ Rainy</option>
                <option value="windy">💨 Windy</option>
              </select>
            </div>

            <div>
              <label className={GOLF_LABEL}>Temperature (°F)</label>
              <input
                type="number"
                value={temperature || ''}
                onChange={(e) => setTemperature(e.target.value ? Number(e.target.value) : undefined)}
                placeholder="75"
                className={GOLF_INPUT}
              />
            </div>

            <div>
              <label className={GOLF_LABEL}>Wind</label>
              <select
                value={wind}
                onChange={(e) => setWind(e.target.value)}
                className={GOLF_SELECT}
              >
                <option value="">Select...</option>
                <option value="calm">Calm (0-5 mph)</option>
                <option value="light">Light (5-10 mph)</option>
                <option value="moderate">Moderate (10-20 mph)</option>
                <option value="strong">Strong (20+ mph)</option>
              </select>
            </div>

            <div>
              <label className={GOLF_LABEL}>Playing Partners</label>
              <input
                type="text"
                value={playingPartners}
                onChange={(e) => setPlayingPartners(e.target.value)}
                placeholder="Names (optional)"
                className={GOLF_INPUT}
              />
            </div>
          </div>
        </div>
      )}

      {/* Scorecard */}
      <div className="bg-surface rounded-lg border border-border overflow-hidden">
        <div className="bg-gradient-to-r from-green-600 to-green-700 text-white p-4">
          <h3 className="text-lg font-semibold flex flex-wrap items-center justify-between gap-2">
            <span>
              <i className="fas fa-clipboard-list mr-2"></i>
              Scorecard
            </span>
            <span className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setQuickEntryRequest(n => n + 1)}
                className="bg-white/20 hover:bg-white/30 text-white text-sm font-semibold px-3 py-2 min-h-[40px] rounded-md transition-colors"
              >
                <i className="fas fa-bolt mr-1"></i>
                Quick entry
              </button>
              {stats && (
                <span className="text-2xl font-bold">
                  {stats.totalScore} ({stats.differential})
                </span>
              )}
            </span>
          </h3>
        </div>

        {/* Scorecard body: course strip, the shared grid, signature. (The
            form's duplicated Front/Back tabs are gone — the grid owns them.) */}
        <div className="bg-surface">
          {/* Scorecard Header */}
          <div className="bg-gradient-to-r from-green-800 to-green-700 text-white px-4 py-2 text-center">
            <div className="flex justify-between items-center">
              <div className="text-sm font-medium">
                {selectedCourse ? selectedCourse.name : courseName || 'Golf Course'}
              </div>
              <div className="text-xs">
                {courseLocation && `${courseLocation} • `}
                {teeBox.charAt(0).toUpperCase() + teeBox.slice(1)} Tees
              </div>
            </div>
          </div>

          {/* One grid for solo + shared (scorecard convergence): the same
              component shared rounds use, with a single player row — same
              sticky column, side-scroll, cells and quick-entry stepper. */}
          <div className="p-4">
            <MultiPlayerScorecardGrid
              players={soloPlayers}
              holes={holeCount}
              editable={true}
              showDetailedStats={true}
              startingHoleNumber={startingHoleNumber}
              courseName={courseName || null}
              holeData={gridHoleData}
              onScoreChange={handleGridScoreChange}
              quickEntryRequest={quickEntryRequest}
            />
          </div>

          {/* Scorecard Signature Area */}
          <div className="bg-surface-sunken px-4 py-3 border-t border-border-strong">
            <div className="flex justify-between items-center text-sm text-primary font-medium">
              <div>Player: ____________________</div>
              <div className="font-bold">Date: {date}</div>
              <div>Marker: ____________________</div>
            </div>
          </div>
        </div>

        {/* Statistics Summary */}
        {stats && (
          <div className="p-4 bg-surface border border-border-strong rounded-lg shadow-sm">
            <h3 className="text-lg font-bold text-primary mb-4 text-center">Round Statistics</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 text-center">
              <div className="bg-yellow-50 dark:bg-yellow-950/40 p-3 rounded-lg border border-border">
                <div className="text-3xl font-bold text-primary">{stats.totalScore}</div>
                <div className="text-sm font-medium text-primary">Total Score</div>
              </div>
              <div className="bg-brand-soft p-3 rounded-lg border border-border">
                <div className="text-3xl font-bold text-primary">{stats.differential}</div>
                <div className="text-sm font-medium text-primary">To Par</div>
              </div>
              <div className="bg-surface-muted p-3 rounded-lg border border-border">
                <div className="text-3xl font-bold text-primary">{stats.totalPutts}</div>
                <div className="text-sm font-medium text-primary">Total Putts</div>
              </div>
              <div className="bg-green-50 dark:bg-green-950/40 p-3 rounded-lg border border-border">
                <div className="text-3xl font-bold text-primary">{stats.fairwayPercentage}%</div>
                <div className="text-sm font-medium text-primary">Fairways</div>
              </div>
              <div className="bg-brand-soft p-3 rounded-lg border border-border">
                <div className="text-3xl font-bold text-primary">{stats.girPercentage}%</div>
                <div className="text-sm font-medium text-primary">GIR</div>
              </div>
              <div className="bg-purple-50 dark:bg-purple-950/40 p-3 rounded-lg border border-border">
                <div className="text-lg font-bold flex justify-center items-center flex-wrap gap-1">
                  <span className="text-yellow-600 dark:text-yellow-400 font-bold">{stats.eagles}</span>
                  <span className="text-primary">•</span>
                  <span className="text-green-700 dark:text-green-300 font-bold">{stats.birdies}</span>
                  <span className="text-primary">•</span>
                  <span className="text-brand-fg-strong font-bold">{stats.pars}</span>
                  <span className="text-primary">•</span>
                  <span className="text-primary font-bold">{stats.bogeys}</span>
                  <span className="text-primary">•</span>
                  <span className="text-red-700 font-bold">{stats.doublePlus}</span>
                </div>
                <div className="text-sm font-medium text-primary mt-1">E•B•P•Bo•D+</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Scorecard Legend & Tips */}
      <div className="bg-surface-muted border border-border rounded-lg p-4">
        <h4 className="text-sm font-semibold text-primary mb-3 flex items-center">
          <i className="fas fa-info-circle mr-2"></i>
          Scorecard Guide
        </h4>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Score Colors */}
          <div>
            <h5 className="text-xs font-semibold text-primary mb-2">Score Colors:</h5>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-yellow-100 dark:bg-yellow-950/60 border-2 border-yellow-400 rounded flex items-center justify-center text-xs font-bold text-yellow-800">2</div>
                <span className="text-xs text-secondary">Eagle (-2 or better)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-green-100 dark:bg-green-950/60 border-2 border-green-400 rounded flex items-center justify-center text-xs font-bold text-green-800">3</div>
                <span className="text-xs text-secondary">Birdie (-1)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-violet-100 dark:bg-violet-950/60 border-2 border-violet-400 rounded flex items-center justify-center text-xs font-bold text-violet-800">4</div>
                <span className="text-xs text-secondary">Par (even)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-surface-sunken border-2 border-border-strong rounded flex items-center justify-center text-xs">5</div>
                <span className="text-xs text-secondary">Bogey (+1)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-red-100 dark:bg-red-950/60 border-2 border-red-400 rounded flex items-center justify-center text-xs text-red-800">6</div>
                <span className="text-xs text-secondary">Double+ (+2 or worse)</span>
              </div>
            </div>
          </div>

          {/* Par Color Coding */}
          <div>
            <h5 className="text-xs font-semibold text-primary mb-2">Par Colors:</h5>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <div className="w-6 h-4 bg-red-100 dark:bg-red-950/60 border border-border-strong rounded"></div>
                <span className="text-xs text-secondary">Par 3 holes</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-4 bg-violet-100 dark:bg-violet-950/60 border border-border-strong rounded"></div>
                <span className="text-xs text-secondary">Par 4 holes</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-4 bg-yellow-100 dark:bg-yellow-950/60 border border-border-strong rounded"></div>
                <span className="text-xs text-secondary">Par 5 holes</span>
              </div>
            </div>

            <h5 className="text-xs font-semibold text-primary mb-2 mt-3">Quick Tips:</h5>
            <ul className="text-xs text-tertiary space-y-1">
              <li>• GIR auto-calculated from score + putts</li>
              <li>• Use Tab to move between fields quickly</li>
              <li>• F = Fairway hit, G = Green in regulation, • = Par 3</li>
              <li>• P = Penalties — tap the badge to edit in quick entry</li>
            </ul>
          </div>
        </div>
      </div>

    </div>

  );
}
