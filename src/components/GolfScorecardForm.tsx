'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useToast } from '@/components/Toast';
import type { GolfCourse } from '@/lib/golf-courses-db';
import type { HoleData } from '@/types/golf';

// Tee box options
const TEE_OPTIONS = [
  { value: 'black', label: 'Black/Tips', color: 'bg-black' },
  { value: 'blue', label: 'Blue', color: 'bg-blue-600' },
  { value: 'white', label: 'White', color: 'bg-white border-gray-400' },
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
  initialData?: Partial<GolfRoundData>;
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
  const [startingHole, setStartingHole] = useState<'front' | 'back'>('front');

  // Round conditions
  const [weather, setWeather] = useState('');
  const [temperature, setTemperature] = useState<number | undefined>();
  const [wind, setWind] = useState('');
  const [playingPartners, setPlayingPartners] = useState('');
  const [handicap, setHandicap] = useState<number | undefined>();

  // Scorecard data
  const [holesData, setHolesData] = useState<HoleData[]>([]);
  const [activeTab, setActiveTab] = useState<'front' | 'back'>('front');

  // Course search
  const [courseSearchOpen, setCourseSearchOpen] = useState(false);
  const [courseSearchQuery, setCourseSearchQuery] = useState('');
  const [availableCourses, setAvailableCourses] = useState<GolfCourse[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedCourse, setSelectedCourse] = useState<GolfCourse | null>(null);

  // Initialize holes data
  useEffect(() => {
    const numHoles = holeCount;
    const startHole = holeCount === 9 && startingHole === 'back' ? 10 : 1;

    const newHolesData: HoleData[] = [];

    // Standard par distribution for 18 holes
    const standardPars18 = [4, 4, 3, 5, 4, 4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 4, 3, 5];

    for (let i = 0; i < numHoles; i++) {
      const holeNumber = startHole + i;

      // Use standard par distribution if within 18, otherwise default to par 4
      let par: number;
      if (holeNumber <= 18) {
        par = standardPars18[holeNumber - 1] || 4;
      } else {
        // For holes beyond 18 (unusual but supported), cycle through pattern
        par = standardPars18[i % 18] || 4;
      }
      const baseYardage = par === 3 ? 150 : par === 4 ? 380 : 520;
      const yardageVariation = Math.floor(Math.random() * 40) - 20;

      newHolesData.push({
        hole: holeNumber,
        par: par,
        yardage: baseYardage + yardageVariation,
        fairway: par === 3 ? 'na' : undefined
      });
    }

    setHolesData(newHolesData);
  }, [holeCount, startingHole]);

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
      }
    } catch (error) {
      console.error('Course search error:', error);
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

  // Update course data when tee box changes
  useEffect(() => {
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
  }, [teeBox, selectedCourse]);

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
    if (!hole.score) return { text: '-', color: 'text-gray-400' };

    const diff = hole.score - hole.par;
    if (diff <= -2) return { text: hole.score, color: 'text-yellow-500 font-bold' }; // Eagle
    if (diff === -1) return { text: hole.score, color: 'text-green-600 font-bold' }; // Birdie
    if (diff === 0) return { text: hole.score, color: 'text-blue-600' }; // Par
    if (diff === 1) return { text: hole.score, color: 'text-gray-700' }; // Bogey
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
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
          <i className="fas fa-golf-ball mr-2 text-green-600"></i>
          Course Information
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Date */}
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
            />
          </div>

          {/* Enhanced Course Search */}
          <div className="relative">
            <label className="text-sm font-medium text-gray-700 block mb-1">
              Course Name
              {selectedCourse && (
                <span className="ml-2 text-xs text-green-600">
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
              className={`w-full px-3 py-2 border rounded-lg focus:ring-2 transition-colors ${
                selectedCourse
                  ? 'border-green-500 focus:ring-green-500 bg-green-50'
                  : 'border-gray-300 focus:ring-green-500'
              }`}
            />

            {/* Enhanced course suggestions dropdown */}
            {courseSearchOpen && (searchLoading || availableCourses.length > 0) && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-64 overflow-y-auto">
                {searchLoading ? (
                  <div className="px-3 py-4 text-center text-gray-500">
                    <i className="fas fa-spinner fa-spin mr-2"></i>
                    Searching courses...
                  </div>
                ) : (
                  availableCourses.map(course => (
                    <button
                      key={course.id}
                      onClick={() => selectCourse(course)}
                      className="w-full px-4 py-3 text-left hover:bg-green-50 border-b border-gray-100 transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="font-medium text-gray-900">{course.name}</div>
                          <div className="text-sm text-gray-600 mt-1">
                            {course.location.city}, {course.location.state}
                            {course.designer && ` • ${course.designer}`}
                          </div>
                          <div className="flex items-center gap-4 text-xs text-gray-500 mt-1">
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
                                className="px-1.5 py-0.5 bg-blue-100 text-blue-700 text-xs rounded"
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
              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg">
                <div className="px-4 py-3 text-center text-gray-500">
                  <i className="fas fa-search mr-2"></i>
                  No courses found. Try &quot;Pebble Beach&quot; or &quot;Augusta&quot;
                </div>
              </div>
            )}
          </div>

          {/* Location */}
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">Location</label>
            <input
              type="text"
              value={courseLocation}
              onChange={(e) => setCourseLocation(e.target.value)}
              placeholder="City, State"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
            />
          </div>

          {/* Tee Box */}
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">Tee Box</label>
            <select
              value={teeBox}
              onChange={(e) => setTeeBox(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
            >
              {TEE_OPTIONS.map(tee => (
                <option key={tee.value} value={tee.value}>
                  {tee.label}
                </option>
              ))}
            </select>
          </div>

          {/* Holes Played - Flexible Input */}
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">
              Holes Played
              <span className="ml-2 text-xs text-gray-500">(Common: 9 or 18, or enter any number)</span>
            </label>
            <input
              type="number"
              min="1"
              max="36"
              value={holeCount}
              onChange={(e) => setHoleCount(Number(e.target.value) || 1)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
              placeholder="Enter number of holes (e.g., 5, 9, 12, 18)"
            />

            {/* Starting hole selector for 9-hole rounds */}
            {holeCount === 9 && (
              <div className="mt-2 flex gap-4">
                <label className="flex items-center text-sm">
                  <input
                    type="radio"
                    value="front"
                    checked={startingHole === 'front'}
                    onChange={(e) => setStartingHole(e.target.value as 'front')}
                    className="mr-1"
                  />
                  Front 9
                </label>
                <label className="flex items-center text-sm">
                  <input
                    type="radio"
                    value="back"
                    checked={startingHole === 'back'}
                    onChange={(e) => setStartingHole(e.target.value as 'back')}
                    className="mr-1"
                  />
                  Back 9
                </label>
              </div>
            )}
          </div>

          {/* Round Type - Indoor/Outdoor */}
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">
              Round Type
            </label>
            <div className="flex gap-4">
              <label className="flex items-center text-sm font-medium text-gray-900 cursor-pointer">
                <input
                  type="radio"
                  value="outdoor"
                  checked={roundType === 'outdoor'}
                  onChange={(e) => setRoundType(e.target.value as 'outdoor')}
                  className="mr-2"
                />
                <i className="fas fa-tree mr-1 text-green-600"></i>
                Outdoor
              </label>
              <label className="flex items-center text-sm font-medium text-gray-900 cursor-pointer">
                <input
                  type="radio"
                  value="indoor"
                  checked={roundType === 'indoor'}
                  onChange={(e) => setRoundType(e.target.value as 'indoor')}
                  className="mr-2"
                />
                <i className="fas fa-warehouse mr-1 text-blue-600"></i>
                Indoor (Simulator/Range)
              </label>
            </div>
          </div>

          {/* Course Rating/Slope */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">Par</label>
              <input
                type="number"
                value={coursePar}
                onChange={(e) => setCoursePar(Number(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">Rating</label>
              <input
                type="number"
                step="0.1"
                value={courseRating || ''}
                onChange={(e) => setCourseRating(e.target.value ? Number(e.target.value) : undefined)}
                placeholder="72.5"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">Slope</label>
              <input
                type="number"
                value={courseSlope || ''}
                onChange={(e) => setCourseSlope(e.target.value ? Number(e.target.value) : undefined)}
                placeholder="130"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
              />
            </div>
          </div>

          {/* Handicap */}
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">Your Handicap</label>
            <input
              type="number"
              value={handicap || ''}
              onChange={(e) => setHandicap(e.target.value ? Number(e.target.value) : undefined)}
              placeholder="Enter handicap (optional)"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
            />
          </div>
        </div>
      </div>

      {/* Playing Conditions - Only show for outdoor rounds */}
      {roundType === 'outdoor' && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <i className="fas fa-cloud-sun mr-2 text-blue-500"></i>
            Playing Conditions
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">Weather</label>
              <select
                value={weather}
                onChange={(e) => setWeather(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
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
              <label className="text-sm font-medium text-gray-700 block mb-1">Temperature (°F)</label>
              <input
                type="number"
                value={temperature || ''}
                onChange={(e) => setTemperature(e.target.value ? Number(e.target.value) : undefined)}
                placeholder="75"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">Wind</label>
              <select
                value={wind}
                onChange={(e) => setWind(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
              >
                <option value="">Select...</option>
                <option value="calm">Calm (0-5 mph)</option>
                <option value="light">Light (5-10 mph)</option>
                <option value="moderate">Moderate (10-20 mph)</option>
                <option value="strong">Strong (20+ mph)</option>
              </select>
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1">Playing Partners</label>
              <input
                type="text"
                value={playingPartners}
                onChange={(e) => setPlayingPartners(e.target.value)}
                placeholder="Names (optional)"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
              />
            </div>
          </div>
        </div>
      )}

      {/* Scorecard */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="bg-gradient-to-r from-green-600 to-green-700 text-white p-4">
          <h3 className="text-lg font-semibold flex items-center justify-between">
            <span>
              <i className="fas fa-clipboard-list mr-2"></i>
              Scorecard
            </span>
            {stats && (
              <span className="text-2xl font-bold">
                {stats.totalScore} ({stats.differential})
              </span>
            )}
          </h3>
        </div>

        {/* Tabs for 18 holes */}
        {holeCount === 18 && (
          <div className="border-b border-gray-200 bg-gray-50">
            <div className="flex">
              <button
                onClick={() => setActiveTab('front')}
                className={`px-6 py-3 font-medium transition-colors ${
                  activeTab === 'front'
                    ? 'bg-white border-b-2 border-green-600 text-green-600'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Front 9
              </button>
              <button
                onClick={() => setActiveTab('back')}
                className={`px-6 py-3 font-medium transition-colors ${
                  activeTab === 'back'
                    ? 'bg-white border-b-2 border-green-600 text-green-600'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Back 9
              </button>
            </div>
          </div>
        )}

        {/* Authentic Golf Scorecard */}
        <div className="overflow-x-auto bg-white">
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

          <table className="w-full border-collapse bg-white">
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
              <tr className="bg-blue-100">
                <td className="px-2 py-2 text-xs font-bold border border-gray-300 text-center bg-blue-200 text-gray-900">PAR</td>
                {holesData
                  .filter(hole => {
                    if (holeCount !== 18) return true; // Show all holes for non-18 hole rounds
                    const holeNum = hole.hole ?? 0;
                    return activeTab === 'front' ? holeNum <= 9 : holeNum > 9;
                  })
                  .map(hole => (
                    <td key={hole.hole} className={`px-2 py-2 text-sm font-bold border border-gray-300 text-center text-gray-900 ${
                      hole.par === 3 ? 'bg-red-100' : hole.par === 5 ? 'bg-yellow-100' : 'bg-blue-100'
                    }`}>
                      {hole.par}
                    </td>
                  ))}
                <td className="px-2 py-2 text-sm font-bold border border-gray-300 text-center bg-blue-200 text-gray-900">
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
              <tr className="bg-gray-50">
                <td className="px-2 py-2 text-xs font-bold border border-gray-300 text-center bg-gray-100 text-gray-900">YDS</td>
                {holesData
                  .filter(hole => {
                    if (holeCount !== 18) return true; // Show all holes for non-18 hole rounds
                    const holeNum = hole.hole ?? 0;
                    return activeTab === 'front' ? holeNum <= 9 : holeNum > 9;
                  })
                  .map(hole => (
                    <td key={hole.hole} className="px-1 py-2 text-xs border border-gray-300 text-center text-gray-800 font-medium">
                      {hole.yardage}
                    </td>
                  ))}
                <td className="px-2 py-2 text-xs font-bold border border-gray-300 text-center bg-gray-100 text-gray-900">
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
              <tr className="bg-gray-50">
                <td className="px-2 py-2 text-xs font-bold border border-gray-300 text-center bg-gray-100 text-gray-900">HCP</td>
                {holesData
                  .filter(hole => {
                    if (holeCount !== 18) return true; // Show all holes for non-18 hole rounds
                    const holeNum = hole.hole ?? 0;
                    return activeTab === 'front' ? holeNum <= 9 : holeNum > 9;
                  })
                  .map(hole => (
                    <td key={hole.hole} className="px-1 py-2 text-xs border border-gray-300 text-center text-gray-800 font-medium">
                      {hole.handicap || '-'}
                    </td>
                  ))}
                <td className="px-2 py-2 text-xs border border-gray-300 text-center bg-gray-100 text-gray-900 font-medium">-</td>
              </tr>
            </thead>

            {/* Score Entry Section */}
            <tbody>
              {/* Score Row */}
              <tr className="bg-white">
                <td className="px-2 py-3 text-xs font-bold border border-gray-300 text-center bg-yellow-100 text-gray-900">SCORE</td>
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
                      <td key={hole.hole} className="px-1 py-2 border border-gray-300 text-center">
                        <input
                          type="number"
                          min="1"
                          max="15"
                          value={hole.score || ''}
                          onChange={(e) => updateHole(actualIndex, 'score', e.target.value ? Number(e.target.value) : undefined)}
                          className={`w-full h-10 text-center text-lg font-bold border-2 rounded focus:outline-none focus:ring-2 focus:ring-green-500 ${
                            hole.score
                              ? score.color === 'text-yellow-500 font-bold' ? 'bg-yellow-100 border-yellow-500 text-yellow-900'
                              : score.color === 'text-green-600 font-bold' ? 'bg-green-100 border-green-500 text-green-900'
                              : score.color === 'text-blue-600' ? 'bg-blue-100 border-blue-500 text-blue-900'
                              : score.color === 'text-red-600' ? 'bg-red-100 border-red-500 text-red-900'
                              : 'bg-gray-100 border-gray-500 text-gray-900'
                              : 'bg-white border-gray-400 text-gray-900'
                          }`}
                          placeholder="−"
                        />
                      </td>
                    );
                  })}
                <td className="px-2 py-2 text-lg font-bold border border-gray-300 text-center bg-yellow-100 text-gray-900">
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
              <tr className="bg-gray-50">
                <td className="px-2 py-2 text-xs font-bold border border-gray-300 text-center bg-gray-100 text-gray-900">PUTTS</td>
                {holesData
                  .filter(hole => {
                    if (holeCount !== 18) return true; // Show all holes for non-18 hole rounds
                    const holeNum = hole.hole ?? 0;
                    return activeTab === 'front' ? holeNum <= 9 : holeNum > 9;
                  })
                  .map((hole, index) => {
                    const actualIndex = holeCount === 18 && activeTab === 'back' ? index + 9 : index;

                    return (
                      <td key={hole.hole} className="px-1 py-2 border border-gray-300 text-center">
                        <input
                          type="number"
                          min="0"
                          max="10"
                          value={hole.putts || ''}
                          onChange={(e) => updateHole(actualIndex, 'putts', e.target.value ? Number(e.target.value) : undefined)}
                          className="w-full h-8 text-center text-sm border border-gray-400 rounded focus:outline-none focus:ring-2 focus:ring-green-500 text-gray-900 bg-white font-medium"
                          placeholder="−"
                        />
                      </td>
                    );
                  })}
                <td className="px-2 py-2 text-sm font-bold border border-gray-300 text-center bg-gray-100 text-gray-900">
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
              <tr className="bg-green-50">
                <td className="px-2 py-2 text-xs font-bold border border-gray-300 text-center bg-green-100 text-gray-900">F/W</td>
                {holesData
                  .filter(hole => {
                    if (holeCount !== 18) return true; // Show all holes for non-18 hole rounds
                    const holeNum = hole.hole ?? 0;
                    return activeTab === 'front' ? holeNum <= 9 : holeNum > 9;
                  })
                  .map((hole, index) => {
                    const actualIndex = holeCount === 18 && activeTab === 'back' ? index + 9 : index;

                    return (
                      <td key={hole.hole} className="px-1 py-2 border border-gray-300 text-center">
                        {hole.par > 3 ? (
                          <select
                            value={hole.fairway || ''}
                            onChange={(e) => updateHole(actualIndex, 'fairway', e.target.value)}
                            className="w-full h-7 text-xs text-center border border-gray-400 rounded focus:outline-none focus:ring-2 focus:ring-green-500 text-gray-900 bg-white font-medium"
                          >
                            <option value="">−</option>
                            <option value="hit">✓</option>
                            <option value="left">←</option>
                            <option value="right">→</option>
                          </select>
                        ) : (
                          <div className="h-7 flex items-center justify-center text-gray-600 text-sm font-bold">•</div>
                        )}
                      </td>
                    );
                  })}
                <td className="px-2 py-2 text-xs border border-gray-300 text-center bg-green-100 text-gray-900 font-bold">
                  {stats ? `${stats.fairwaysHit}/${holesData.filter(h => h.par > 3 && (holeCount !== 18 ? true : activeTab === 'front' ? (h.hole ?? 0) <= 9 : (h.hole ?? 0) > 9)).length}` : '−'}
                </td>
              </tr>

              {/* GIR Row */}
              <tr className="bg-blue-50">
                <td className="px-2 py-2 text-xs font-bold border border-gray-300 text-center bg-blue-100 text-gray-900">GIR</td>
                {holesData
                  .filter(hole => {
                    if (holeCount !== 18) return true; // Show all holes for non-18 hole rounds
                    const holeNum = hole.hole ?? 0;
                    return activeTab === 'front' ? holeNum <= 9 : holeNum > 9;
                  })
                  .map((hole, index) => {
                    const actualIndex = holeCount === 18 && activeTab === 'back' ? index + 9 : index;

                    return (
                      <td key={hole.hole} className="px-1 py-2 border border-gray-300 text-center">
                        <div className="flex justify-center">
                          <input
                            type="checkbox"
                            checked={hole.gir || false}
                            onChange={(e) => updateHole(actualIndex, 'gir', e.target.checked)}
                            className="w-5 h-5 text-blue-600 border-2 border-gray-400 rounded focus:ring-blue-500"
                          />
                        </div>
                      </td>
                    );
                  })}
                <td className="px-2 py-2 text-xs border border-gray-300 text-center bg-blue-100 text-gray-900 font-bold">
                  {stats ? `${stats.greensInRegulation}/${holesData.filter(h => holeCount !== 18 ? true : activeTab === 'front' ? (h.hole ?? 0) <= 9 : (h.hole ?? 0) > 9).length}` : '−'}
                </td>
              </tr>
            </tbody>
          </table>

          {/* Scorecard Signature Area */}
          <div className="bg-gray-100 px-4 py-3 border-t border-gray-400">
            <div className="flex justify-between items-center text-sm text-gray-900 font-medium">
              <div>Player: ____________________</div>
              <div className="font-bold">Date: {date}</div>
              <div>Marker: ____________________</div>
            </div>
          </div>
        </div>

        {/* Statistics Summary */}
        {stats && (
          <div className="p-4 bg-white border border-gray-300 rounded-lg shadow-sm">
            <h3 className="text-lg font-bold text-gray-900 mb-4 text-center">Round Statistics</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 text-center">
              <div className="bg-yellow-50 p-3 rounded-lg border">
                <div className="text-3xl font-bold text-gray-900">{stats.totalScore}</div>
                <div className="text-sm font-medium text-gray-800">Total Score</div>
              </div>
              <div className="bg-blue-50 p-3 rounded-lg border">
                <div className="text-3xl font-bold text-gray-900">{stats.differential}</div>
                <div className="text-sm font-medium text-gray-800">To Par</div>
              </div>
              <div className="bg-gray-50 p-3 rounded-lg border">
                <div className="text-3xl font-bold text-gray-900">{stats.totalPutts}</div>
                <div className="text-sm font-medium text-gray-800">Total Putts</div>
              </div>
              <div className="bg-green-50 p-3 rounded-lg border">
                <div className="text-3xl font-bold text-gray-900">{stats.fairwayPercentage}%</div>
                <div className="text-sm font-medium text-gray-800">Fairways</div>
              </div>
              <div className="bg-blue-50 p-3 rounded-lg border">
                <div className="text-3xl font-bold text-gray-900">{stats.girPercentage}%</div>
                <div className="text-sm font-medium text-gray-800">GIR</div>
              </div>
              <div className="bg-purple-50 p-3 rounded-lg border">
                <div className="text-lg font-bold flex justify-center items-center flex-wrap gap-1">
                  <span className="text-yellow-600 font-bold">{stats.eagles}</span>
                  <span className="text-gray-800">•</span>
                  <span className="text-green-700 font-bold">{stats.birdies}</span>
                  <span className="text-gray-800">•</span>
                  <span className="text-blue-700 font-bold">{stats.pars}</span>
                  <span className="text-gray-800">•</span>
                  <span className="text-gray-800 font-bold">{stats.bogeys}</span>
                  <span className="text-gray-800">•</span>
                  <span className="text-red-700 font-bold">{stats.doublePlus}</span>
                </div>
                <div className="text-sm font-medium text-gray-800 mt-1">E•B•P•Bo•D+</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Scorecard Legend & Tips */}
      <div className="bg-gradient-to-r from-blue-50 to-green-50 border border-blue-200 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-blue-900 mb-3 flex items-center">
          <i className="fas fa-info-circle mr-2"></i>
          Scorecard Guide
        </h4>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Score Colors */}
          <div>
            <h5 className="text-xs font-semibold text-blue-800 mb-2">Score Colors:</h5>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-yellow-100 border-2 border-yellow-400 rounded flex items-center justify-center text-xs font-bold text-yellow-800">2</div>
                <span className="text-xs text-blue-800">Eagle (-2 or better)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-green-100 border-2 border-green-400 rounded flex items-center justify-center text-xs font-bold text-green-800">3</div>
                <span className="text-xs text-blue-800">Birdie (-1)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-blue-100 border-2 border-blue-400 rounded flex items-center justify-center text-xs font-bold text-blue-800">4</div>
                <span className="text-xs text-blue-800">Par (even)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-gray-100 border-2 border-gray-400 rounded flex items-center justify-center text-xs">5</div>
                <span className="text-xs text-blue-800">Bogey (+1)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 bg-red-100 border-2 border-red-400 rounded flex items-center justify-center text-xs text-red-800">6</div>
                <span className="text-xs text-blue-800">Double+ (+2 or worse)</span>
              </div>
            </div>
          </div>

          {/* Par Color Coding */}
          <div>
            <h5 className="text-xs font-semibold text-blue-800 mb-2">Par Colors:</h5>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <div className="w-6 h-4 bg-red-100 border border-gray-300 rounded"></div>
                <span className="text-xs text-blue-800">Par 3 holes</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-4 bg-blue-100 border border-gray-300 rounded"></div>
                <span className="text-xs text-blue-800">Par 4 holes</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-4 bg-yellow-100 border border-gray-300 rounded"></div>
                <span className="text-xs text-blue-800">Par 5 holes</span>
              </div>
            </div>

            <h5 className="text-xs font-semibold text-blue-800 mb-2 mt-3">Quick Tips:</h5>
            <ul className="text-xs text-blue-800 space-y-1">
              <li>• GIR auto-calculated from score + putts</li>
              <li>• Use Tab to move between fields quickly</li>
              <li>• F/W: ✓=Hit, ←=Left, →=Right, •=Par 3</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}