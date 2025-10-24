'use client';

import { useState, useEffect, useCallback } from 'react';
import { cssClasses } from '@/lib/design-tokens';
import { useToast } from '@/components/Toast';

interface GolfRoundData {
  // Round basics
  date: string;
  course: string;
  tee?: string;
  holes: 9 | 18;

  // Scorecard summary
  grossScore?: number;
  par: number;
  firPercentage?: number;
  girPercentage?: number;
  totalPutts?: number;
  notes?: string;
}

interface GolfHoleData {
  date: string;
  course?: string;
  holeNumber: number;
  par?: number;
  strokes?: number;
  putts?: number;
  fairwayHit?: boolean;
  greenInRegulation?: boolean;
}

interface EnhancedGolfFormProps {
  onDataChange: (data: { mode: 'round_recap' | 'hole_highlight'; roundData?: GolfRoundData; holeData?: GolfHoleData }) => void;
}

type GolfMode = 'round_recap' | 'hole_highlight';

// Popular courses for suggestions (constant, moved outside component)
const POPULAR_COURSES = [
  'Pebble Beach Golf Links',
  'Augusta National Golf Club',
  'St. Andrews Old Course',
  'Pinehurst No. 2',
  'Torrey Pines (South)',
  'TPC Sawgrass',
  'Bethpage Black',
  'Whistling Straits',
  'Kiawah Island (Ocean Course)',
  'Bandon Dunes'
];

export default function EnhancedGolfForm({ onDataChange }: EnhancedGolfFormProps) {
  const { showError } = useToast();

  // Mode selection
  const [mode, setMode] = useState<GolfMode>('round_recap');

  // Round Recap data
  const [roundData, setRoundData] = useState<GolfRoundData>({
    date: new Date().toISOString().split('T')[0],
    course: '',
    tee: '',
    holes: 18,
    grossScore: undefined,
    par: 72,
    firPercentage: undefined,
    girPercentage: undefined,
    totalPutts: undefined,
    notes: ''
  });

  // Hole Highlight data
  const [holeData, setHoleData] = useState<GolfHoleData>({
    date: new Date().toISOString().split('T')[0],
    course: '',
    holeNumber: 1,
    par: 4,
    strokes: undefined,
    putts: undefined,
    fairwayHit: undefined,
    greenInRegulation: undefined
  });

  // Course search
  const [courseSearchTerm, setCourseSearchTerm] = useState('');
  const [courseResults, setCourseResults] = useState<string[]>([]);
  const [showCourseDropdown, setShowCourseDropdown] = useState(false);
  
  // Update parent when data changes
  useEffect(() => {
    if (mode === 'round_recap') {
      onDataChange({ mode, roundData });
    } else {
      onDataChange({ mode, holeData });
    }
  }, [mode, roundData, holeData, onDataChange]);
  
  // Course search functionality
  useEffect(() => {
    if (courseSearchTerm.length > 0) {
      const filtered = POPULAR_COURSES.filter(course =>
        course.toLowerCase().includes(courseSearchTerm.toLowerCase())
      );
      setCourseResults(filtered);
      setShowCourseDropdown(filtered.length > 0);
    } else {
      setCourseResults([]);
      setShowCourseDropdown(false);
    }
  }, [courseSearchTerm]);
  
  const handleModeChange = (newMode: GolfMode) => {
    setMode(newMode);
    // Sync dates between modes
    if (newMode === 'hole_highlight') {
      setHoleData(prev => ({ ...prev, date: roundData.date }));
    } else {
      setRoundData(prev => ({ ...prev, date: holeData.date }));
    }
  };
  
  const handleRoundDataChange = (updates: Partial<GolfRoundData>) => {
    setRoundData(prev => ({ ...prev, ...updates }));
  };
  
  const handleHoleDataChange = (updates: Partial<GolfHoleData>) => {
    setHoleData(prev => ({ ...prev, ...updates }));
  };
  
  const handleCourseSelect = (course: string) => {
    setCourseSearchTerm(course);
    if (mode === 'round_recap') {
      handleRoundDataChange({ course });
    } else {
      handleHoleDataChange({ course });
    }
    setShowCourseDropdown(false);
  };

  const validateForm = useCallback((): boolean => {
    if (mode === 'round_recap') {
      if (!roundData.date) {
        showError('Validation Error', 'Date is required');
        return false;
      }
      if (!roundData.course.trim()) {
        showError('Validation Error', 'Course name is required');
        return false;
      }
      return true;
    } else {
      if (!holeData.date) {
        showError('Validation Error', 'Date is required');
        return false;
      }
      if (holeData.holeNumber < 1 || holeData.holeNumber > 18) {
        showError('Validation Error', 'Hole number must be between 1 and 18');
        return false;
      }
      return true;
    }
  }, [mode, roundData, holeData, showError]);

  // Expose validation to parent
  useEffect(() => {
    (onDataChange as { validate?: () => boolean }).validate = validateForm;
  }, [validateForm, onDataChange]);

  return (
    <div className="space-y-base">
      <div>
        <h3 className={`${cssClasses.TYPOGRAPHY.H3} text-gray-900 mb-micro`}>Golf Performance</h3>
        <p className={`${cssClasses.TYPOGRAPHY.LABEL} text-gray-600`}>
          Share your round recap or highlight a specific hole
        </p>
      </div>

      {/* Mode Selection */}
      <div className="space-y-micro">
        <label className={`block ${cssClasses.TYPOGRAPHY.LABEL} font-medium text-gray-700`}>
          What would you like to share?
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-micro">
          <button
            type="button"
            onClick={() => handleModeChange('round_recap')}
            className={`p-base border-2 rounded-lg text-left transition-all ${
              mode === 'round_recap'
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            <div className="flex items-center space-x-micro">
              <i className="fas fa-golf-ball text-lg text-green-600"></i>
              <div>
                <div className={`${cssClasses.TYPOGRAPHY.BODY} font-medium text-gray-900`}>
                  Round Recap
                </div>
                <div className={`${cssClasses.TYPOGRAPHY.CHIP} text-gray-500`}>
                  Share your full round performance
                </div>
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => handleModeChange('hole_highlight')}
            className={`p-base border-2 rounded-lg text-left transition-all ${
              mode === 'hole_highlight'
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-200 bg-white hover:border-gray-300'
            }`}
          >
            <div className="flex items-center space-x-micro">
              <i className="fas fa-flag text-lg text-red-600"></i>
              <div>
                <div className={`${cssClasses.TYPOGRAPHY.BODY} font-medium text-gray-900`}>
                  Hole Highlight
                </div>
                <div className={`${cssClasses.TYPOGRAPHY.CHIP} text-gray-500`}>
                  Highlight a specific hole moment
                </div>
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* Round Recap Form */}
      {mode === 'round_recap' && (
        <div className="space-y-base">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-base">
            <div>
              <label className={`block ${cssClasses.TYPOGRAPHY.LABEL} font-medium text-gray-700 mb-1`}>
                Date *
              </label>
              <input
                type="date"
                value={roundData.date}
                onChange={(e) => handleRoundDataChange({ date: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
            </div>

            <div>
              <label className={`block ${cssClasses.TYPOGRAPHY.LABEL} font-medium text-gray-700 mb-1`}>
                Holes Played *
              </label>
              <select
                value={roundData.holes}
                onChange={(e) => handleRoundDataChange({ holes: parseInt(e.target.value) as 9 | 18 })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              >
                <option value={9}>9 Holes</option>
                <option value={18}>18 Holes</option>
              </select>
            </div>

            <div className="sm:col-span-2 relative">
              <label className={`block ${cssClasses.TYPOGRAPHY.LABEL} font-medium text-gray-700 mb-1`}>
                Course Name *
              </label>
              <input
                type="text"
                value={courseSearchTerm || roundData.course}
                onChange={(e) => {
                  setCourseSearchTerm(e.target.value);
                  handleRoundDataChange({ course: e.target.value });
                }}
                onFocus={() => courseResults.length > 0 && setShowCourseDropdown(true)}
                onBlur={() => setTimeout(() => setShowCourseDropdown(false), 200)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Search courses or enter custom name"
                required
              />
              
              {showCourseDropdown && courseResults.length > 0 && (
                <div className="absolute top-full left-0 right-0 z-10 bg-white border border-gray-300 rounded-md shadow-lg max-h-48 overflow-y-auto">
                  {courseResults.map((course, index) => (
                    <button
                      key={index}
                      type="button"
                      onClick={() => handleCourseSelect(course)}
                      className="w-full text-left px-3 py-2 hover:bg-gray-100 focus:bg-gray-100 focus:outline-none"
                    >
                      {course}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className={`block ${cssClasses.TYPOGRAPHY.LABEL} font-medium text-gray-700 mb-1`}>
                Tees Played
              </label>
              <select
                value={roundData.tee || ''}
                onChange={(e) => handleRoundDataChange({ tee: e.target.value || undefined })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">Select tees</option>
                <option value="Black">Black Tees</option>
                <option value="Blue">Blue Tees</option>
                <option value="White">White Tees</option>
                <option value="Gold">Gold Tees</option>
                <option value="Red">Red Tees</option>
              </select>
            </div>

            <div>
              <label className={`block ${cssClasses.TYPOGRAPHY.LABEL} font-medium text-gray-700 mb-1`}>
                Course Par
              </label>
              <input
                type="number"
                value={roundData.par}
                onChange={(e) => handleRoundDataChange({ par: parseInt(e.target.value) || 72 })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                min="54"
                max="90"
              />
            </div>

            <div>
              <label className={`block ${cssClasses.TYPOGRAPHY.LABEL} font-medium text-gray-700 mb-1`}>
                Your Score
              </label>
              <input
                type="number"
                value={roundData.grossScore || ''}
                onChange={(e) => handleRoundDataChange({ grossScore: e.target.value ? parseInt(e.target.value) : undefined })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="82"
                min="1"
                max="200"
              />
            </div>

            <div>
              <label className={`block ${cssClasses.TYPOGRAPHY.LABEL} font-medium text-gray-700 mb-1`}>
                Total Putts
              </label>
              <input
                type="number"
                value={roundData.totalPutts || ''}
                onChange={(e) => handleRoundDataChange({ totalPutts: e.target.value ? parseInt(e.target.value) : undefined })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="32"
                min="0"
                max="100"
              />
            </div>

            <div>
              <label className={`block ${cssClasses.TYPOGRAPHY.LABEL} font-medium text-gray-700 mb-1`}>
                FIR % (Fairways in Regulation)
              </label>
              <input
                type="number"
                value={roundData.firPercentage || ''}
                onChange={(e) => handleRoundDataChange({ firPercentage: e.target.value ? parseFloat(e.target.value) : undefined })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="71"
                min="0"
                max="100"
                step="0.1"
              />
            </div>

            <div>
              <label className={`block ${cssClasses.TYPOGRAPHY.LABEL} font-medium text-gray-700 mb-1`}>
                GIR % (Greens in Regulation)
              </label>
              <input
                type="number"
                value={roundData.girPercentage || ''}
                onChange={(e) => handleRoundDataChange({ girPercentage: e.target.value ? parseFloat(e.target.value) : undefined })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="58"
                min="0"
                max="100"
                step="0.1"
              />
            </div>

            <div className="sm:col-span-2">
              <label className={`block ${cssClasses.TYPOGRAPHY.LABEL} font-medium text-gray-700 mb-1`}>
                Round Notes
              </label>
              <textarea
                value={roundData.notes || ''}
                onChange={(e) => handleRoundDataChange({ notes: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                rows={3}
                placeholder="Great day on the course! Weather was perfect and I played well from the tee."
              />
            </div>
          </div>
        </div>
      )}

      {/* Hole Highlight Form */}
      {mode === 'hole_highlight' && (
        <div className="space-y-base">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-base">
            <div>
              <label className={`block ${cssClasses.TYPOGRAPHY.LABEL} font-medium text-gray-700 mb-1`}>
                Date *
              </label>
              <input
                type="date"
                value={holeData.date}
                onChange={(e) => handleHoleDataChange({ date: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
            </div>

            <div>
              <label className={`block ${cssClasses.TYPOGRAPHY.LABEL} font-medium text-gray-700 mb-1`}>
                Hole Number *
              </label>
              <select
                value={holeData.holeNumber}
                onChange={(e) => handleHoleDataChange({ holeNumber: parseInt(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              >
                {Array.from({ length: 18 }, (_, i) => i + 1).map(num => (
                  <option key={num} value={num}>Hole {num}</option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-2 relative">
              <label className={`block ${cssClasses.TYPOGRAPHY.LABEL} font-medium text-gray-700 mb-1`}>
                Course Name
              </label>
              <input
                type="text"
                value={courseSearchTerm || holeData.course || ''}
                onChange={(e) => {
                  setCourseSearchTerm(e.target.value);
                  handleHoleDataChange({ course: e.target.value });
                }}
                onFocus={() => courseResults.length > 0 && setShowCourseDropdown(true)}
                onBlur={() => setTimeout(() => setShowCourseDropdown(false), 200)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Optional - search courses or enter custom name"
              />
              
              {showCourseDropdown && courseResults.length > 0 && (
                <div className="absolute top-full left-0 right-0 z-10 bg-white border border-gray-300 rounded-md shadow-lg max-h-48 overflow-y-auto">
                  {courseResults.map((course, index) => (
                    <button
                      key={index}
                      type="button"
                      onClick={() => handleCourseSelect(course)}
                      className="w-full text-left px-3 py-2 hover:bg-gray-100 focus:bg-gray-100 focus:outline-none"
                    >
                      {course}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className={`block ${cssClasses.TYPOGRAPHY.LABEL} font-medium text-gray-700 mb-1`}>
                Hole Par
              </label>
              <select
                value={holeData.par || ''}
                onChange={(e) => handleHoleDataChange({ par: e.target.value ? parseInt(e.target.value) : undefined })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">Select par</option>
                <option value={3}>Par 3</option>
                <option value={4}>Par 4</option>
                <option value={5}>Par 5</option>
                <option value={6}>Par 6</option>
              </select>
            </div>

            <div>
              <label className={`block ${cssClasses.TYPOGRAPHY.LABEL} font-medium text-gray-700 mb-1`}>
                Your Score
              </label>
              <input
                type="number"
                value={holeData.strokes || ''}
                onChange={(e) => handleHoleDataChange({ strokes: e.target.value ? parseInt(e.target.value) : undefined })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="4"
                min="1"
                max="15"
              />
            </div>

            <div>
              <label className={`block ${cssClasses.TYPOGRAPHY.LABEL} font-medium text-gray-700 mb-1`}>
                Putts
              </label>
              <input
                type="number"
                value={holeData.putts || ''}
                onChange={(e) => handleHoleDataChange({ putts: e.target.value ? parseInt(e.target.value) : undefined })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="2"
                min="0"
                max="8"
              />
            </div>

            {/* Par-aware fairway field */}
            {holeData.par && holeData.par > 3 && (
              <div>
                <label className={`block ${cssClasses.TYPOGRAPHY.LABEL} font-medium text-gray-700 mb-1`}>
                  Fairway Hit
                </label>
                <div className="flex space-x-base">
                  <label className="flex items-center">
                    <input
                      type="radio"
                      name="fairwayHit"
                      checked={holeData.fairwayHit === true}
                      onChange={() => handleHoleDataChange({ fairwayHit: true })}
                      className="mr-2"
                    />
                    <span className={cssClasses.TYPOGRAPHY.LABEL}>Yes</span>
                  </label>
                  <label className="flex items-center">
                    <input
                      type="radio"
                      name="fairwayHit"
                      checked={holeData.fairwayHit === false}
                      onChange={() => handleHoleDataChange({ fairwayHit: false })}
                      className="mr-2"
                    />
                    <span className={cssClasses.TYPOGRAPHY.LABEL}>No</span>
                  </label>
                  <label className="flex items-center">
                    <input
                      type="radio"
                      name="fairwayHit"
                      checked={holeData.fairwayHit === undefined}
                      onChange={() => handleHoleDataChange({ fairwayHit: undefined })}
                      className="mr-2"
                    />
                    <span className={cssClasses.TYPOGRAPHY.LABEL}>N/A</span>
                  </label>
                </div>
              </div>
            )}

            <div>
              <label className={`block ${cssClasses.TYPOGRAPHY.LABEL} font-medium text-gray-700 mb-1`}>
                Green in Regulation
              </label>
              <div className="flex space-x-base">
                <label className="flex items-center">
                  <input
                    type="radio"
                    name="greenInRegulation"
                    checked={holeData.greenInRegulation === true}
                    onChange={() => handleHoleDataChange({ greenInRegulation: true })}
                    className="mr-2"
                  />
                  <span className={cssClasses.TYPOGRAPHY.LABEL}>Yes</span>
                </label>
                <label className="flex items-center">
                  <input
                    type="radio"
                    name="greenInRegulation"
                    checked={holeData.greenInRegulation === false}
                    onChange={() => handleHoleDataChange({ greenInRegulation: false })}
                    className="mr-2"
                  />
                  <span className={cssClasses.TYPOGRAPHY.LABEL}>No</span>
                </label>
                <label className="flex items-center">
                  <input
                    type="radio"
                    name="greenInRegulation"
                    checked={holeData.greenInRegulation === undefined}
                    onChange={() => handleHoleDataChange({ greenInRegulation: undefined })}
                    className="mr-2"
                  />
                  <span className={cssClasses.TYPOGRAPHY.LABEL}>N/A</span>
                </label>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}