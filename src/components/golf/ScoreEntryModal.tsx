'use client';

import { useState } from 'react';
import type { GolfHoleScore } from '@/types/group-posts';
import type { HoleData } from '@/types/golf';

interface ScoreEntryModalProps {
  groupPostId: string;
  participantId: string;
  holesPlayed: number;
  existingScores?: GolfHoleScore[];
  onSave: (scores: Array<{
    hole_number: number;
    strokes: number;
    putts?: number;
    fairway_hit?: boolean;
    green_in_regulation?: boolean;
  }>) => Promise<void>;
  onClose: () => void;
}

export default function ScoreEntryModal({
  groupPostId,
  participantId,
  holesPlayed,
  existingScores = [],
  onSave,
  onClose
}: ScoreEntryModalProps) {
  const [currentHole, setCurrentHole] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize hole data
  const [holeData, setHoleData] = useState<HoleData[]>(() => {
    const holes: HoleData[] = [];
    for (let i = 1; i <= holesPlayed; i++) {
      const existing = existingScores.find(s => s.hole_number === i);
      holes.push({
        hole_number: i,
        strokes: existing?.strokes ?? null,
        putts: existing?.putts ?? null,
        fairway_hit: existing?.fairway_hit ?? null,
        green_in_regulation: existing?.green_in_regulation ?? null,
        par: 4, // Estimated par
      });
    }
    return holes;
  });

  const currentHoleData = holeData[currentHole - 1];

  const updateCurrentHole = (field: keyof HoleData, value: number | boolean | null) => {
    setHoleData(prev => prev.map((h, idx) =>
      idx === currentHole - 1 ? { ...h, [field]: value } : h
    ));
    setError(null);
  };

  const handleStrokeClick = (strokes: number) => {
    updateCurrentHole('strokes', strokes);
  };

  const handlePuttClick = (putts: number) => {
    updateCurrentHole('putts', putts);
  };

  const handleNext = () => {
    if (!currentHoleData.strokes) {
      setError('Please enter a stroke count before continuing');
      return;
    }
    if (currentHole < holesPlayed) {
      setCurrentHole(prev => prev + 1);
      setError(null);
    }
  };

  const handlePrevious = () => {
    if (currentHole > 1) {
      setCurrentHole(prev => prev - 1);
      setError(null);
    }
  };

  const handleJumpToHole = (holeNum: number) => {
    setCurrentHole(holeNum);
    setError(null);
  };

  const handleSave = async () => {
    // Validate: at least some scores entered
    const hasScores = holeData.some(h => h.strokes !== null);
    if (!hasScores) {
      setError('Please enter scores for at least one hole');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      // Filter out holes with no strokes entered
      const scores = holeData
        .filter(h => h.strokes !== null)
        .map(h => ({
          hole_number: h.hole_number!,
          strokes: h.strokes!,
          putts: h.putts ?? undefined,
          fairway_hit: h.fairway_hit ?? undefined,
          green_in_regulation: h.green_in_regulation ?? undefined,
        }));

      await onSave(scores);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save scores');
      setSaving(false);
    }
  };

  // Calculate totals
  const totalStrokes = holeData.reduce((sum, h) => sum + (h.strokes || 0), 0);
  const totalPutts = holeData.reduce((sum, h) => sum + (h.putts || 0), 0);
  const holesCompleted = holeData.filter(h => h.strokes !== null).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl max-w-md w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-green-600 text-white p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xl font-black">Enter Scores</h2>
            <button
              onClick={onClose}
              className="text-white hover:text-gray-200 text-xl font-bold"
            >
              <i className="fas fa-times"></i>
            </button>
          </div>
          <div className="text-sm font-semibold">
            Hole {currentHole} of {holesPlayed}
          </div>
        </div>

        {/* Progress Bar */}
        <div className="bg-gray-200 h-2">
          <div
            className="bg-green-600 h-full transition-all duration-300"
            style={{ width: `${(holesCompleted / holesPlayed) * 100}%` }}
          />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Current Hole Display */}
          <div className="text-center mb-6">
            <div className="text-5xl font-black text-green-900 mb-2">
              Hole {currentHole}
            </div>
            <div className="text-sm text-gray-600">
              Par {4} {/* Estimated par */}
            </div>
          </div>

          {/* Strokes Entry */}
          <div className="mb-6">
            <label className="block text-sm font-bold text-gray-900 mb-3">Strokes</label>
            <div className="grid grid-cols-5 gap-2">
              {[2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(num => (
                <button
                  key={num}
                  onClick={() => handleStrokeClick(num)}
                  className={`py-3 px-2 rounded-lg font-bold text-lg transition-colors ${
                    currentHoleData.strokes === num
                      ? 'bg-green-600 text-white'
                      : 'bg-gray-100 text-gray-900 hover:bg-gray-200'
                  }`}
                >
                  {num}
                </button>
              ))}
            </div>
          </div>

          {/* Putts Entry */}
          <div className="mb-6">
            <label className="block text-sm font-bold text-gray-900 mb-3">Putts (optional)</label>
            <div className="grid grid-cols-5 gap-2">
              {[0, 1, 2, 3, 4].map(num => (
                <button
                  key={num}
                  onClick={() => handlePuttClick(num)}
                  className={`py-3 px-2 rounded-lg font-bold text-lg transition-colors ${
                    currentHoleData.putts === num
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-900 hover:bg-gray-200'
                  }`}
                >
                  {num}
                </button>
              ))}
            </div>
          </div>

          {/* Optional Stats */}
          <div className="border-t border-gray-200 pt-4 mb-4">
            <div className="text-xs font-bold text-gray-700 mb-2">Optional Stats</div>
            <div className="flex gap-2">
              <button
                onClick={() => updateCurrentHole('fairway_hit', !currentHoleData.fairway_hit)}
                className={`flex-1 py-2 px-3 rounded-lg text-sm font-semibold transition-colors ${
                  currentHoleData.fairway_hit
                    ? 'bg-green-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <i className="fas fa-check mr-1"></i>
                FIR
              </button>
              <button
                onClick={() => updateCurrentHole('green_in_regulation', !currentHoleData.green_in_regulation)}
                className={`flex-1 py-2 px-3 rounded-lg text-sm font-semibold transition-colors ${
                  currentHoleData.green_in_regulation
                    ? 'bg-green-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                <i className="fas fa-check mr-1"></i>
                GIR
              </button>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">
              {error}
            </div>
          )}

          {/* Current Totals */}
          <div className="bg-gray-50 rounded-lg p-4 mb-4">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className="text-xs text-gray-600 mb-1">Holes</div>
                <div className="text-xl font-black text-gray-900">{holesCompleted}/{holesPlayed}</div>
              </div>
              <div>
                <div className="text-xs text-gray-600 mb-1">Strokes</div>
                <div className="text-xl font-black text-gray-900">{totalStrokes}</div>
              </div>
              <div>
                <div className="text-xs text-gray-600 mb-1">Putts</div>
                <div className="text-xl font-black text-gray-900">{totalPutts}</div>
              </div>
            </div>
          </div>

          {/* Hole Navigation Grid */}
          <div>
            <div className="text-xs font-bold text-gray-700 mb-2">Jump to Hole:</div>
            <div className="grid grid-cols-9 gap-1">
              {Array.from({ length: holesPlayed }, (_, i) => i + 1).map(holeNum => {
                const hole = holeData[holeNum - 1];
                const hasScore = hole.strokes !== null;
                const isCurrent = holeNum === currentHole;

                return (
                  <button
                    key={holeNum}
                    onClick={() => handleJumpToHole(holeNum)}
                    className={`py-2 px-1 rounded text-xs font-bold transition-colors ${
                      isCurrent
                        ? 'bg-green-600 text-white ring-2 ring-green-800'
                        : hasScore
                        ? 'bg-blue-100 text-blue-900 hover:bg-blue-200'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {holeNum}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer Navigation */}
        <div className="bg-gray-100 border-t border-gray-300 p-4">
          <div className="flex items-center justify-between gap-3">
            <button
              onClick={handlePrevious}
              disabled={currentHole === 1}
              className="flex-1 bg-gray-600 hover:bg-gray-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded-lg transition-colors"
            >
              <i className="fas fa-chevron-left mr-2"></i>
              Previous
            </button>

            {currentHole < holesPlayed ? (
              <button
                onClick={handleNext}
                className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-4 rounded-lg transition-colors"
              >
                Next
                <i className="fas fa-chevron-right ml-2"></i>
              </button>
            ) : (
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded-lg transition-colors"
              >
                {saving ? (
                  <>
                    <i className="fas fa-spinner fa-spin mr-2"></i>
                    Saving...
                  </>
                ) : (
                  <>
                    <i className="fas fa-save mr-2"></i>
                    Save Scores
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
