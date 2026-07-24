'use client';

import { useState } from 'react';
import { holePar } from '@/lib/golf/scoring';
import type { GolfHoleScore } from '@/types/group-posts';
import type { HoleData } from '@/types/golf';

interface ScoreEntryModalProps {
  groupPostId: string;
  participantId: string;
  holesPlayed: number;
  /** First hole number (10 for back-9 rounds). Defaults to 1. */
  startingHoleNumber?: number;
  existingScores?: GolfHoleScore[];
  onSave: (scores: Array<{
    hole_number: number;
    strokes: number;
    putts?: number;
    fairway_hit?: boolean;
    green_in_regulation?: boolean;
  }>) => Promise<void>;
  // LIVE mode: when provided, each hole is persisted as you advance (rather
  // than all-at-once via onSave), so co-players watching the round see your
  // scores stream in hole-by-hole. Should POST the single hole and resolve.
  onSaveHole?: (hole: {
    hole_number: number;
    strokes: number;
    putts?: number;
    fairway_hit?: boolean;
    green_in_regulation?: boolean;
  }) => Promise<void>;
  onClose: () => void;
}

export default function ScoreEntryModal({
  groupPostId: _groupPostId, // eslint-disable-line @typescript-eslint/no-unused-vars
  participantId: _participantId, // eslint-disable-line @typescript-eslint/no-unused-vars
  holesPlayed,
  startingHoleNumber = 1,
  existingScores = [],
  onSave,
  onSaveHole,
  onClose
}: ScoreEntryModalProps) {
  const isLive = !!onSaveHole;
  const [currentHole, setCurrentHole] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Live-mode per-hole persistence state. Holes present in existingScores
  // start "saved"; any local edit marks a hole dirty until it re-saves.
  const [savedHoles, setSavedHoles] = useState<Set<number>>(
    () => new Set(existingScores.map(s => s.hole_number))
  );
  const [dirtyHoles, setDirtyHoles] = useState<Set<number>>(new Set());
  const [savingHole, setSavingHole] = useState<number | null>(null);

  // Initialize hole data
  const [holeData, setHoleData] = useState<HoleData[]>(() => {
    const holes: HoleData[] = [];
    for (let i = 1; i <= holesPlayed; i++) {
      const holeNumber = startingHoleNumber + i - 1;
      const existing = existingScores.find(s => s.hole_number === holeNumber);
      holes.push({
        hole_number: holeNumber,
        strokes: existing?.strokes ?? null,
        putts: existing?.putts ?? null,
        fairway_hit: existing?.fairway_hit ?? null,
        green_in_regulation: existing?.green_in_regulation ?? null,
        par: holePar(i, null), // shared fallback (no course hole data in this modal yet)
      });
    }
    return holes;
  });

  const currentHoleData = holeData[currentHole - 1];

  const updateCurrentHole = (field: keyof HoleData, value: number | boolean | null) => {
    setHoleData(prev => prev.map((h, idx) =>
      idx === currentHole - 1 ? { ...h, [field]: value } : h
    ));
    // In live mode, editing a hole marks it dirty (needs a re-save on advance)
    if (isLive) {
      setDirtyHoles(prev => new Set(prev).add(currentHole));
    }
    setError(null);
  };

  const handleStrokeClick = (strokes: number) => {
    updateCurrentHole('strokes', strokes);
  };

  const handlePuttClick = (putts: number) => {
    updateCurrentHole('putts', putts);
  };

  // Live mode: persist a single hole (if it has a score and is dirty).
  // Returns true if OK to proceed (saved or nothing to save), false on error.
  const persistHole = async (holeNum: number): Promise<boolean> => {
    if (!isLive || !onSaveHole) return true;
    const hole = holeData[holeNum - 1];
    if (!hole || hole.strokes === null) return true; // nothing complete to save
    if (!dirtyHoles.has(holeNum) && savedHoles.has(holeNum)) return true; // unchanged

    setSavingHole(holeNum);
    setError(null);
    try {
      await onSaveHole({
        hole_number: hole.hole_number!,
        strokes: hole.strokes!,
        putts: hole.putts ?? undefined,
        fairway_hit: hole.fairway_hit ?? undefined,
        green_in_regulation: hole.green_in_regulation ?? undefined,
      });
      setSavedHoles(prev => new Set(prev).add(holeNum));
      setDirtyHoles(prev => { const n = new Set(prev); n.delete(holeNum); return n; });
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save this hole');
      return false;
    } finally {
      setSavingHole(null);
    }
  };

  const handleNext = async () => {
    if (!currentHoleData.strokes) {
      setError('Please enter a stroke count before continuing');
      return;
    }
    if (isLive && !(await persistHole(currentHole))) return; // save before advancing
    if (currentHole < holesPlayed) {
      setCurrentHole(prev => prev + 1);
      setError(null);
    }
  };

  const handlePrevious = async () => {
    if (isLive) await persistHole(currentHole);
    if (currentHole > 1) {
      setCurrentHole(prev => prev - 1);
      setError(null);
    }
  };

  const handleJumpToHole = async (holeNum: number) => {
    if (isLive) await persistHole(currentHole);
    setCurrentHole(holeNum);
    setError(null);
  };

  // Live mode: holes are already saved as you go, so "Done" just flushes the
  // current hole and closes. Also used as the close handler so nothing dirty
  // is lost when the user taps ✕.
  const handleDone = async () => {
    setSaving(true);
    const ok = await persistHole(currentHole);
    setSaving(false);
    if (ok) onClose();
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save scores');
      setSaving(false);
    }
  };

  // Calculate totals
  const totalStrokes = holeData.reduce((sum, h) => sum + (h.strokes || 0), 0);
  const totalPutts = holeData.reduce((sum, h) => sum + (h.putts || 0), 0);
  const holesCompleted = holeData.filter(h => h.strokes !== null).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-lg shadow-2xl max-w-md w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-green-600 text-white p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black">Enter Scores</h2>
              {isLive && (
                <span className="inline-flex items-center gap-1 bg-white/20 px-2 py-0.5 rounded-full text-xs font-bold">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse"></span>
                  LIVE
                </span>
              )}
            </div>
            <button
              onClick={isLive ? handleDone : onClose}
              className="text-white hover:text-gray-200 text-xl font-bold min-w-[44px] min-h-[44px] -m-2 flex items-center justify-center"
              aria-label="Close"
            >
              <i className="fas fa-times"></i>
            </button>
          </div>
          <div className="text-sm font-semibold flex items-center gap-2">
            <span>Hole {currentHole} of {holesPlayed}</span>
            {isLive && savingHole === currentHole && (
              <span className="text-xs font-normal opacity-90"><i className="fas fa-spinner fa-spin mr-1"></i>Saving…</span>
            )}
            {isLive && savingHole !== currentHole && savedHoles.has(currentHole) && !dirtyHoles.has(currentHole) && (
              <span className="text-xs font-normal opacity-90"><i className="fas fa-check mr-1"></i>Saved</span>
            )}
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
              Hole {currentHoleData.hole_number}
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
            <div className="grid grid-cols-6 sm:grid-cols-9 gap-1">
              {Array.from({ length: holesPlayed }, (_, i) => i + 1).map(holeNum => {
                const hole = holeData[holeNum - 1];
                const hasScore = hole.strokes !== null;
                const isCurrent = holeNum === currentHole;
                const isSaved = isLive && savedHoles.has(holeNum) && !dirtyHoles.has(holeNum);

                return (
                  <button
                    key={holeNum}
                    onClick={() => handleJumpToHole(holeNum)}
                    className={`relative py-2 px-1 rounded text-xs font-bold transition-colors ${
                      isCurrent
                        ? 'bg-green-600 text-white ring-2 ring-green-800'
                        : hasScore
                        ? 'bg-blue-100 text-blue-900 hover:bg-blue-200'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                    title={isSaved ? 'Saved' : undefined}
                  >
                    {hole.hole_number}
                    {isSaved && !isCurrent && (
                      <span className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full flex items-center justify-center">
                        <i className="fas fa-check text-white" style={{ fontSize: '7px' }}></i>
                      </span>
                    )}
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
                disabled={savingHole !== null}
                className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white font-bold py-3 px-4 rounded-lg transition-colors"
              >
                {savingHole === currentHole ? (
                  <><i className="fas fa-spinner fa-spin mr-2"></i>Saving…</>
                ) : (
                  <>Next<i className="fas fa-chevron-right ml-2"></i></>
                )}
              </button>
            ) : isLive ? (
              <button
                onClick={handleDone}
                disabled={saving || savingHole !== null}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded-lg transition-colors"
              >
                {saving || savingHole !== null ? (
                  <><i className="fas fa-spinner fa-spin mr-2"></i>Saving…</>
                ) : (
                  <><i className="fas fa-check mr-2"></i>Done</>
                )}
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
