'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import ScoreEntryModal from '@/components/golf/ScoreEntryModal';
import { useToast } from '@/components/Toast';
import type { GolfCourse } from '@/lib/golf-courses-db';
import { totalPenalties } from '@/lib/golf/penalties';
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
  const [activeTab, setActiveTab] = useState<'front' | 'back'>('front');
  const [showQuickEntry, setShowQuickEntry] = useState(false);
  // Hole NUMBER a PEN cell asked the quick-entry modal to open at; null =
  // the modal's own first-incomplete-hole resume logic.
  const [quickEntryHole, setQuickEntryHole] = useState<number | null>(null);

  // Course search
  const [courseSearchOpen, setCourseSearchOpen] = useState(false);
  const [courseSearchQuery, setCourseSearchQuery] = useState('');
  const [availableCourses, setAvailableCourses] = useState<GolfCourse[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState<GolfCourse | null>(null);

  // Switch between 18- and 9-hole rounds. Adjusts the default course par
  // (72 <-> 36) only when the current value IS the other mode's default, so a
  // custom par the user typed is never stomped. Also snaps the scorecard's
  // tab filter to a valid state for the new mode.
  const handleHoleCountChange = (count: number) => {
    setHoleCount(count);
    if (count === 9 && coursePar === 72) setCoursePar(36);
    if (count === 18 && coursePar === 36) setCoursePar(72);
    if (count === 18) {
      setActiveTab('front');
    } else {
      setActiveTab(startingHole === 'back' ? 'back' : 'front');
    }
  };

  // 9-hole rounds can start on the back nine (holes 10-18). The table's
  // front/back filter keys off activeTab, so keep it in sync.
  const handleStartingHoleChange = (start: 'front' | 'back') => {
    setStartingHole(start);
    if (holeCount === 9) setActiveTab(start);
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


  // Search for golf courses
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
        console.error('Failed to search golf courses (scorecard) — status:', response.status);
      }
    } catch (e) {
      console.error('Failed to search golf courses (scorecard):', e);
      setAvailableCourses([]);
    } finally {
      setSearchLoading(false);
    }
  }, []);

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

  // Update hole data
  const updateHole = (holeIndex: number, field: keyof HoleData, value: number | boolean | string | undefined) => {
    const newHolesData = [...holesData];
    newHolesData[holeIndex] = { ...newHolesData[holeIndex], [field]: value };

    // Auto-calculate GIR
    if (field === 'score' || field === 'putts') {
      const hole = newHolesData[holeIndex];
      if (hole.score && hole.putts) {
        const strokesToGreen = hole.score - hole.putts;
        const parStrokes = hole.par - 2; // GIR means reaching in par-2
        hole.gir = strokesToGreen <= parStrokes;
      }
    }

    setHolesData(newHolesData);
  };

  // Get score display with color
  const getScoreDisplay = (hole: HoleData) => {
    if (!hole.score) return { text: '-', color: 'text-faint' };

    const diff = hole.score - hole.par;
    if (diff <= -2) return { text: hole.score, color: 'text-yellow-500 font-bold' }; // Eagle
    if (diff === -1) return { text: hole.score, color: 'text-green-600 font-bold' }; // Birdie
    if (diff === 0) return { text: hole.score, color: 'text-brand-fg' }; // Par
    if (diff === 1) return { text: hole.score, color: 'text-secondary' }; // Bogey
    return { text: hole.score, color: 'text-red-600' }; // Double+
  };


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
                if (courseSearchQuery.length >= 2) {
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
            {courseSearchOpen && (searchLoading || availableCourses.length > 0) && (
              <div className="absolute z-10 w-full mt-1 bg-surface-raised border border-border-strong rounded-lg shadow-lg max-h-64 overflow-y-auto">
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
                    onClick={() => handleStartingHoleChange('front')}
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
                    onClick={() => handleStartingHoleChange('back')}
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
                onClick={() => {
                  setQuickEntryHole(null); // header entry resumes normally
                  setShowQuickEntry(true);
                }}
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

        {/* Tabs for 18 holes */}
        {holeCount === 18 && (
          <div className="border-b border-border bg-surface-muted">
            <div className="flex">
              <button
                onClick={() => setActiveTab('front')}
                className={`px-6 py-3 font-medium transition-colors ${
                  activeTab === 'front'
                    ? 'bg-surface border-b-2 border-green-600 text-green-600 dark:text-green-400'
                    : 'text-tertiary hover:text-primary'
                }`}
              >
                Front 9
              </button>
              <button
                onClick={() => setActiveTab('back')}
                className={`px-6 py-3 font-medium transition-colors ${
                  activeTab === 'back'
                    ? 'bg-surface border-b-2 border-green-600 text-green-600 dark:text-green-400'
                    : 'text-tertiary hover:text-primary'
                }`}
              >
                Back 9
              </button>
            </div>
          </div>
        )}

        {/* Authentic Golf Scorecard */}
        <div className="overflow-x-auto bg-surface">
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

          <table className="w-full border-collapse bg-surface">
            {/* Traditional Scorecard Header */}
            <thead>
              {/* Hole Numbers Row */}
              <tr className="bg-green-600 text-white">
                <td className="px-2 py-2 text-xs font-bold border border-green-700 text-center">HOLE</td>
                {holesData
                  .filter(hole => {
                    if (holeCount !== 18) return true; // Show all holes for non-18 hole rounds
                    const holeNum = hole.hole ?? 0;
                    return activeTab === 'front' ? holeNum <= 9 : holeNum > 9;
                  })
                  .map(hole => (
                    <td key={hole.hole} className="px-2 py-2 text-sm font-bold border border-green-700 text-center min-w-[40px]">
                      {hole.hole}
                    </td>
                  ))}
                <td className="px-2 py-2 text-xs font-bold border border-green-700 text-center bg-green-700">
                  {holeCount === 18 ? (activeTab === 'front' ? 'OUT' : 'IN') : 'TOTAL'}
                </td>
              </tr>

              {/* Par Row */}
              <tr className="bg-violet-100 dark:bg-violet-950/60">
                <td className="px-2 py-2 text-xs font-bold border border-border-strong text-center bg-violet-200 dark:bg-violet-900/50 text-primary">PAR</td>
                {holesData
                  .filter(hole => {
                    if (holeCount !== 18) return true; // Show all holes for non-18 hole rounds
                    const holeNum = hole.hole ?? 0;
                    return activeTab === 'front' ? holeNum <= 9 : holeNum > 9;
                  })
                  .map(hole => (
                    <td key={hole.hole} className={`px-2 py-2 text-sm font-bold border border-border-strong text-center text-primary ${
                      hole.par === 3 ? 'bg-red-100 dark:bg-red-950/60' : hole.par === 5 ? 'bg-yellow-100 dark:bg-yellow-950/60' : 'bg-violet-100 dark:bg-violet-950/60'
                    }`}>
                      {hole.par}
                    </td>
                  ))}
                <td className="px-2 py-2 text-sm font-bold border border-border-strong text-center bg-violet-200 dark:bg-violet-900/50 text-primary">
                  {holesData
                    .filter(h => {
                      if (holeCount !== 18) return true; // Show all holes for non-18 hole rounds
                      const holeNum = h.hole ?? 0;
                      return activeTab === 'front' ? holeNum <= 9 : holeNum > 9;
                    })
                    .reduce((sum, h) => sum + h.par, 0)}
                </td>
              </tr>

              {/* Yardage Row */}
              <tr className="bg-surface-muted">
                <td className="px-2 py-2 text-xs font-bold border border-border-strong text-center bg-surface-sunken text-primary">YDS</td>
                {holesData
                  .filter(hole => {
                    if (holeCount !== 18) return true; // Show all holes for non-18 hole rounds
                    const holeNum = hole.hole ?? 0;
                    return activeTab === 'front' ? holeNum <= 9 : holeNum > 9;
                  })
                  .map(hole => (
                    <td key={hole.hole} className="px-1 py-2 text-xs border border-border-strong text-center text-primary font-medium">
                      {hole.yardage}
                    </td>
                  ))}
                <td className="px-2 py-2 text-xs font-bold border border-border-strong text-center bg-surface-sunken text-primary">
                  {holesData
                    .filter(h => {
                      if (holeCount !== 18) return true; // Show all holes for non-18 hole rounds
                      const holeNum = h.hole ?? 0;
                      return activeTab === 'front' ? holeNum <= 9 : holeNum > 9;
                    })
                    .reduce((sum, h) => sum + (h.yardage ?? 0), 0)}
                </td>
              </tr>

              {/* Handicap Row */}
              <tr className="bg-surface-muted">
                <td className="px-2 py-2 text-xs font-bold border border-border-strong text-center bg-surface-sunken text-primary">HCP</td>
                {holesData
                  .filter(hole => {
                    if (holeCount !== 18) return true; // Show all holes for non-18 hole rounds
                    const holeNum = hole.hole ?? 0;
                    return activeTab === 'front' ? holeNum <= 9 : holeNum > 9;
                  })
                  .map(hole => (
                    <td key={hole.hole} className="px-1 py-2 text-xs border border-border-strong text-center text-primary font-medium">
                      {hole.handicap || '-'}
                    </td>
                  ))}
                <td className="px-2 py-2 text-xs border border-border-strong text-center bg-surface-sunken text-primary font-medium">-</td>
              </tr>
            </thead>

            {/* Score Entry Section */}
            <tbody>
              {/* Score Row */}
              <tr className="bg-surface">
                <td className="px-2 py-3 text-xs font-bold border border-border-strong text-center bg-yellow-100 dark:bg-yellow-950/60 text-primary">SCORE</td>
                {holesData
                  .filter(hole => {
                    if (holeCount !== 18) return true; // Show all holes for non-18 hole rounds
                    const holeNum = hole.hole ?? 0;
                    return activeTab === 'front' ? holeNum <= 9 : holeNum > 9;
                  })
                  .map((hole, index) => {
                    const actualIndex = holeCount === 18 && activeTab === 'back' ? index + 9 : index;
                    const score = getScoreDisplay(hole);

                    return (
                      <td key={hole.hole} className="px-1 py-2 border border-border-strong text-center">
                        <input
                          type="number"
                          min="1"
                          max="15"
                          value={hole.score || ''}
                          onChange={(e) => updateHole(actualIndex, 'score', e.target.value ? Number(e.target.value) : undefined)}
                          className={`w-full h-10 text-center text-lg font-bold border-2 rounded ${
                            hole.score
                              ? score.color === 'text-yellow-500 font-bold' ? 'bg-yellow-100 dark:bg-yellow-950/60 border-yellow-500 text-yellow-900 dark:text-yellow-200'
                              : score.color === 'text-green-600 font-bold' ? 'bg-green-100 dark:bg-green-950/60 border-green-500 text-green-900 dark:text-green-200'
                              : score.color === 'text-brand-fg' ? 'bg-violet-100 dark:bg-violet-950/60 border-violet-500 text-violet-900 dark:text-violet-200'
                              : score.color === 'text-red-600' ? 'bg-red-100 dark:bg-red-950/60 border-red-500 text-red-900 dark:text-red-200'
                              : 'bg-surface-sunken border-border-strong text-primary'
                              : 'bg-surface border-border-strong text-primary'
                          }`}
                          placeholder="−"
                        />
                      </td>
                    );
                  })}
                <td className="px-2 py-2 text-lg font-bold border border-border-strong text-center bg-yellow-100 dark:bg-yellow-950/60 text-primary">
                  <div className="h-10 flex items-center justify-center">
                    {stats ?
                      holesData
                        .filter(h => {
                          if (holeCount !== 18) return true; // Show all holes for non-18 hole rounds
                          const holeNum = h.hole ?? 0;
                          return activeTab === 'front' ? holeNum <= 9 : holeNum > 9;
                        })
                        .reduce((sum, h) => sum + (h.score || 0), 0) || '−'
                      : '−'
                    }
                  </div>
                </td>
              </tr>

              {/* Putts Row */}
              <tr className="bg-surface-muted">
                <td className="px-2 py-2 text-xs font-bold border border-border-strong text-center bg-surface-sunken text-primary">PUTTS</td>
                {holesData
                  .filter(hole => {
                    if (holeCount !== 18) return true; // Show all holes for non-18 hole rounds
                    const holeNum = hole.hole ?? 0;
                    return activeTab === 'front' ? holeNum <= 9 : holeNum > 9;
                  })
                  .map((hole, index) => {
                    const actualIndex = holeCount === 18 && activeTab === 'back' ? index + 9 : index;

                    return (
                      <td key={hole.hole} className="px-1 py-2 border border-border-strong text-center">
                        <input
                          type="number"
                          min="0"
                          max="10"
                          value={hole.putts || ''}
                          onChange={(e) => updateHole(actualIndex, 'putts', e.target.value ? Number(e.target.value) : undefined)}
                          className="w-full h-8 text-center text-sm border border-border-strong rounded text-primary bg-surface font-medium"
                          placeholder="−"
                        />
                      </td>
                    );
                  })}
                <td className="px-2 py-2 text-sm font-bold border border-border-strong text-center bg-surface-sunken text-primary">
                  {stats ?
                    holesData
                      .filter(h => {
                        if (holeCount !== 18) return true; // Show all holes for non-18 hole rounds
                        const holeNum = h.hole ?? 0;
                        return activeTab === 'front' ? holeNum <= 9 : holeNum > 9;
                      })
                      .reduce((sum, h) => sum + (h.putts || 0), 0) || '−'
                    : '−'
                  }
                </td>
              </tr>

              {/* Fairway Row */}
              <tr className="bg-green-50 dark:bg-green-950/40">
                <td className="px-2 py-2 text-xs font-bold border border-border-strong text-center bg-green-100 dark:bg-green-950/60 text-primary">F/W</td>
                {holesData
                  .filter(hole => {
                    if (holeCount !== 18) return true; // Show all holes for non-18 hole rounds
                    const holeNum = hole.hole ?? 0;
                    return activeTab === 'front' ? holeNum <= 9 : holeNum > 9;
                  })
                  .map((hole, index) => {
                    const actualIndex = holeCount === 18 && activeTab === 'back' ? index + 9 : index;

                    return (
                      <td key={hole.hole} className="px-1 py-2 border border-border-strong text-center">
                        {hole.par > 3 ? (
                          <select
                            value={hole.fairway || ''}
                            onChange={(e) => updateHole(actualIndex, 'fairway', e.target.value)}
                            className="w-full h-7 text-xs text-center border border-border-strong rounded text-primary bg-surface font-medium"
                          >
                            <option value="">−</option>
                            <option value="hit">✓</option>
                            <option value="left">←</option>
                            <option value="right">→</option>
                          </select>
                        ) : (
                          <div className="h-7 flex items-center justify-center text-tertiary text-sm font-bold">•</div>
                        )}
                      </td>
                    );
                  })}
                <td className="px-2 py-2 text-xs border border-border-strong text-center bg-green-100 dark:bg-green-950/60 text-primary font-bold">
                  {stats ? `${stats.fairwaysHit}/${holesData.filter(h => h.par > 3 && (holeCount !== 18 ? true : activeTab === 'front' ? (h.hole ?? 0) <= 9 : (h.hole ?? 0) > 9)).length}` : '−'}
                </td>
              </tr>

              {/* GIR Row */}
              <tr className="bg-brand-soft">
                <td className="px-2 py-2 text-xs font-bold border border-border-strong text-center bg-violet-100 dark:bg-violet-950/60 text-primary">GIR</td>
                {holesData
                  .filter(hole => {
                    if (holeCount !== 18) return true; // Show all holes for non-18 hole rounds
                    const holeNum = hole.hole ?? 0;
                    return activeTab === 'front' ? holeNum <= 9 : holeNum > 9;
                  })
                  .map((hole, index) => {
                    const actualIndex = holeCount === 18 && activeTab === 'back' ? index + 9 : index;

                    return (
                      <td key={hole.hole} className="px-1 py-2 border border-border-strong text-center">
                        <div className="flex justify-center">
                          <input
                            type="checkbox"
                            checked={hole.gir || false}
                            onChange={(e) => updateHole(actualIndex, 'gir', e.target.checked)}
                            className="w-5 h-5 text-brand-fg border-2 border-border-strong rounded"
                          />
                        </div>
                      </td>
                    );
                  })}
                <td className="px-2 py-2 text-xs border border-border-strong text-center bg-violet-100 dark:bg-violet-950/60 text-primary font-bold">
                  {stats ? `${stats.greensInRegulation}/${holesData.filter(h => holeCount !== 18 ? true : activeTab === 'front' ? (h.hole ?? 0) <= 9 : (h.hole ?? 0) > 9).length}` : '−'}
                </td>
              </tr>

              {/* Penalties Row — read-only in the grid; each cell opens the
                  quick-entry stepper AT that hole, where penalties are edited
                  (dropdown + count — too much control for a 40px table cell) */}
              <tr className="bg-surface-muted">
                <td className="px-2 py-2 text-xs font-bold border border-border-strong text-center bg-surface-sunken text-primary">PEN</td>
                {holesData
                  .filter(hole => {
                    if (holeCount !== 18) return true; // Show all holes for non-18 hole rounds
                    const holeNum = hole.hole ?? 0;
                    return activeTab === 'front' ? holeNum <= 9 : holeNum > 9;
                  })
                  .map(hole => {
                    const penCount = totalPenalties(hole.penalties);
                    return (
                      <td key={hole.hole} className="px-1 py-2 border border-border-strong text-center">
                        <button
                          type="button"
                          onClick={() => {
                            if (typeof hole.hole === 'number') setQuickEntryHole(hole.hole);
                            setShowQuickEntry(true);
                          }}
                          className={`w-full h-8 flex items-center justify-center text-sm rounded font-medium ${
                            penCount > 0 ? 'text-amber-600 dark:text-amber-400 font-bold' : 'text-faint'
                          } hover:bg-border transition-colors`}
                          title={`Edit hole ${hole.hole} in quick entry`}
                          aria-label={`Hole ${hole.hole}: ${penCount} penalt${penCount === 1 ? 'y' : 'ies'} — edit in quick entry`}
                        >
                          {penCount > 0 ? penCount : '−'}
                        </button>
                      </td>
                    );
                  })}
                <td className="px-2 py-2 text-sm font-bold border border-border-strong text-center bg-surface-sunken text-primary">
                  {(() => {
                    const total = holesData
                      .filter(h => {
                        if (holeCount !== 18) return true; // Show all holes for non-18 hole rounds
                        const holeNum = h.hole ?? 0;
                        return activeTab === 'front' ? holeNum <= 9 : holeNum > 9;
                      })
                      .reduce((sum, h) => sum + totalPenalties(h.penalties), 0);
                    return total || '−';
                  })()}
                </td>
              </tr>
            </tbody>
          </table>

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
              <li>• F/W: ✓=Hit, ←=Left, →=Right, •=Par 3</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Quick entry: hole-by-hole stepper (same modal shared rounds use).
          Maps in/out of this form's holesData — the 72-field table stays for
          those who prefer it; this is the mobile-friendly path. */}
      {showQuickEntry && (
        <ScoreEntryModal
          groupPostId=""
          participantId=""
          holesPlayed={holeCount}
          startingHoleNumber={holeCount === 9 && startingHole === 'back' ? 10 : 1}
          holeData={holesData
            .filter(h => typeof h.hole === 'number')
            .map(h => ({ hole: h.hole as number, par: h.par, yardage: h.yardage }))}
          courseName={courseName || null}
          existingScores={holesData
            .filter(h => h.score !== undefined && h.score !== null)
            .map(h => ({
              hole_number: h.hole,
              strokes: h.score as number,
              putts: h.putts ?? null,
              fairway_hit: h.fairway === 'hit' ? true : h.fairway === 'left' || h.fairway === 'right' ? false : null,
              green_in_regulation: h.gir ?? null,
              penalties: h.penalties ?? null,
            })) as never}
          initialHole={quickEntryHole ?? undefined}
          onSave={async (scores) => {
            setHolesData(prev => prev.map(hole => {
              const entered = scores.find(sc => sc.hole_number === hole.hole);
              if (!entered) return hole;
              return {
                ...hole,
                score: entered.strokes,
                putts: entered.putts,
                fairway: hole.par === 3
                  ? 'na'
                  : entered.fairway_hit === true ? 'hit'
                  // boolean miss loses direction — keep an existing left/right,
                  // else default to 'left'
                  : entered.fairway_hit === false
                    ? (hole.fairway === 'left' || hole.fairway === 'right' ? hole.fairway : 'left')
                  : hole.fairway,
                gir: entered.green_in_regulation ?? hole.gir,
                penalties: entered.penalties ?? null,
              };
            }));
          }}
          onClose={() => {
            setShowQuickEntry(false);
            setQuickEntryHole(null);
          }}
        />
      )}
    </div>

  );
}
