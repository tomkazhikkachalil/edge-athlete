'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import AppHeader from '@/components/AppHeader';
import ConfirmModal from '@/components/ConfirmModal';
import { useToast } from '@/components/Toast';

interface GolfHole {
  hole_number: number;
  par: number | null;
  strokes: number;
  putts: number | null;
  fairway_hit: boolean | null;
  green_in_regulation: boolean;
  distance_yards: number | null;
  notes: string | null;
}

interface GolfRound {
  id: string;
  profile_id: string;
  date: string;
  course: string;
  course_location: string | null;
  tee: string | null;
  holes: number;
  round_type: string;
  par: number;
  gross_score: number | null;
  total_putts: number | null;
  fir_percentage: number | null;
  gir_percentage: number | null;
  weather: string | null;
  temperature: number | null;
  wind: string | null;
  course_rating: number | null;
  slope_rating: number | null;
  notes: string | null;
  is_complete: boolean;
  golf_holes: GolfHole[];
}

// Editable copy of a hole row while in edit mode
interface EditableHole {
  hole_number: number;
  par: number | null;
  strokes: string; // string in inputs; validated on save
  putts: string;
  fairway_hit: boolean | null;
  green_in_regulation: boolean;
}

export default function GolfRoundDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { showSuccess, showError } = useToast();

  const [round, setRound] = useState<GolfRound | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Edit mode
  const [editing, setEditing] = useState(false);
  const [editHoles, setEditHoles] = useState<EditableHole[]>([]);
  const [saving, setSaving] = useState(false);

  // Delete
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const roundId = params.roundId as string;

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/');
      return;
    }
  }, [user, authLoading, router]);

  const loadRound = useCallback(async () => {
    if (!roundId) return;
    try {
      setLoading(true);
      const response = await fetch(`/api/golf/rounds/${roundId}`);
      if (!response.ok) {
        setNotFound(true);
        return;
      }
      const data = await response.json();
      setRound(data.round);
      setIsOwner(!!data.isOwner);
    } catch (e) {
      console.error('Failed to load golf round detail:', e);
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [roundId]);

  useEffect(() => {
    if (user?.id) loadRound();
  }, [user?.id, loadRound]);

  const startEditing = () => {
    if (!round) return;
    setEditHoles(
      round.golf_holes.map(h => ({
        hole_number: h.hole_number,
        par: h.par,
        strokes: String(h.strokes ?? ''),
        putts: h.putts === null ? '' : String(h.putts),
        fairway_hit: h.fairway_hit,
        green_in_regulation: h.green_in_regulation,
      }))
    );
    setEditing(true);
  };

  const updateEditHole = (holeNumber: number, patch: Partial<EditableHole>) => {
    setEditHoles(prev => prev.map(h => (h.hole_number === holeNumber ? { ...h, ...patch } : h)));
  };

  const handleSave = async () => {
    if (saving) return;

    // Client-side validation mirror of the API's rules
    const payload = [];
    for (const h of editHoles) {
      const strokes = parseInt(h.strokes, 10);
      if (!Number.isInteger(strokes) || strokes < 1 || strokes > 20) {
        showError('Invalid score', `Hole ${h.hole_number}: score must be between 1 and 20.`);
        return;
      }
      const putts = h.putts === '' ? null : parseInt(h.putts, 10);
      if (putts !== null && (!Number.isInteger(putts) || putts < 0 || putts > 10)) {
        showError('Invalid putts', `Hole ${h.hole_number}: putts must be between 0 and 10.`);
        return;
      }
      payload.push({
        hole_number: h.hole_number,
        par: h.par,
        strokes,
        putts,
        fairway_hit: h.fairway_hit,
        green_in_regulation: h.green_in_regulation,
      });
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/golf/rounds/${roundId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ holes: payload }),
      });
      const data = await response.json();
      if (!response.ok) {
        showError('Save failed', data.error || 'Could not save changes.');
        return;
      }
      setRound(data.round);
      setEditing(false);
      showSuccess('Round updated', 'Scores saved and stats recalculated.');
    } catch (e) {
      console.error('Failed to save round:', e);
      showError('Save failed', 'Could not save changes. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      const response = await fetch(`/api/golf/rounds/${roundId}`, { method: 'DELETE' });
      if (!response.ok) {
        const data = await response.json();
        showError('Delete failed', data.error || 'Could not delete round.');
        setDeleting(false);
        setShowDeleteConfirm(false);
        return;
      }
      showSuccess('Round deleted');
      router.push('/athlete');
    } catch (e) {
      console.error('Failed to delete round:', e);
      showError('Delete failed', 'Could not delete round. Please try again.');
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand mx-auto"></div>
          <p className="mt-2 text-tertiary">Loading round details...</p>
        </div>
      </div>
    );
  }

  if (!user) return null; // redirecting

  if (notFound || !round) {
    return (
      <div className="min-h-screen bg-canvas">
        <AppHeader showSearch={false} />
        <div className="flex items-center justify-center py-20">
          <div className="text-center px-4">
            <h1 className="text-2xl sm:text-4xl font-bold text-primary mb-4">Round Not Found</h1>
            <p className="text-tertiary mb-8">This golf round does not exist or you don&apos;t have access to it.</p>
            <button
              onClick={() => router.back()}
              className="inline-flex items-center px-4 py-2 border border-transparent text-base font-medium rounded-md text-white bg-brand hover:bg-brand-hover transition-colors"
            >
              <i className="fas fa-arrow-left mr-2"></i>
              Go Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  const holes = round.golf_holes || [];
  const holesPlayed = holes.length;
  const grossScore = round.gross_score ?? holes.reduce((sum, h) => sum + (h.strokes || 0), 0);
  const parPlayed = holes.reduce((sum, h) => sum + (h.par || 0), 0) || round.par;
  const scoreToPar = grossScore - parPlayed;
  const fairwayEligible = holes.filter(h => (h.par ?? 4) > 3);
  const fairwaysHit = fairwayEligible.filter(h => h.fairway_hit === true).length;
  const girsHit = holes.filter(h => h.green_in_regulation).length;
  const totalPutts = round.total_putts ?? holes.reduce((sum, h) => sum + (h.putts || 0), 0);
  const conditions = [round.weather, round.temperature != null ? `${round.temperature}°` : null, round.wind]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="min-h-screen bg-canvas">
      <AppHeader showSearch={false} />

      {/* Navigation + actions */}
      <div className="bg-surface border-b border-border">
        <div className="max-w-4xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <button
              onClick={() => router.back()}
              className="inline-flex items-center min-h-[44px] text-sm text-tertiary hover:text-primary transition-colors"
            >
              <i className="fas fa-arrow-left mr-2"></i>
              Back
            </button>
            {isOwner && !editing && (
              <div className="flex items-center gap-2">
                <button
                  onClick={startEditing}
                  className="inline-flex items-center min-h-[44px] px-3 py-2 border border-border-strong rounded-md text-sm font-medium text-secondary bg-surface hover:bg-surface-muted transition-colors"
                >
                  <i className="fas fa-edit mr-1"></i>
                  Edit
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="inline-flex items-center min-h-[44px] px-3 py-2 border border-red-300 dark:border-red-700 rounded-md text-sm font-medium text-red-700 dark:text-red-300 bg-surface hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                >
                  <i className="fas fa-trash mr-1"></i>
                  Delete
                </button>
              </div>
            )}
            {isOwner && editing && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setEditing(false)}
                  disabled={saving}
                  className="inline-flex items-center min-h-[44px] px-3 py-2 border border-border-strong rounded-md text-sm font-medium text-secondary bg-surface hover:bg-surface-muted transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="inline-flex items-center min-h-[44px] px-4 py-2 rounded-md text-sm font-medium text-white bg-brand hover:bg-brand-hover transition-colors disabled:opacity-50"
                >
                  {saving ? (
                    <><i className="fas fa-spinner fa-spin mr-2"></i>Saving…</>
                  ) : (
                    <><i className="fas fa-check mr-1"></i>Save</>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Round header */}
        <div className="bg-surface rounded-lg shadow-sm p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4">
            <div className="min-w-0">
              <h1 className="text-2xl sm:text-3xl font-bold text-primary mb-1 break-words">{round.course}</h1>
              {round.course_location && (
                <p className="text-sm text-muted mb-1">{round.course_location}</p>
              )}
              <p className="text-tertiary text-sm">
                <i className="fas fa-calendar mr-2"></i>
                {new Date(round.date + 'T00:00:00').toLocaleDateString('en-US', {
                  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                })}
              </p>
              <div className="flex flex-wrap gap-2 mt-2 text-xs text-tertiary">
                {round.tee && <span className="px-2 py-1 bg-surface-sunken rounded-full">{round.tee} tees</span>}
                <span className="px-2 py-1 bg-surface-sunken rounded-full">{round.round_type === 'indoor' ? 'Indoor / Sim' : 'Outdoor'}</span>
                <span className="px-2 py-1 bg-surface-sunken rounded-full">{holesPlayed} holes</span>
                {!round.is_complete && <span className="px-2 py-1 bg-yellow-100 dark:bg-yellow-950/60 text-yellow-700 dark:text-yellow-300 rounded-full">Partial round</span>}
              </div>
            </div>
            <div className="text-left sm:text-right flex-shrink-0">
              <div className="text-4xl font-bold text-primary">{grossScore}</div>
              <div className={`text-sm font-medium ${
                scoreToPar === 0 ? 'text-brand-fg' : scoreToPar > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'
              }`}>
                {scoreToPar === 0 ? 'E' : scoreToPar > 0 ? `+${scoreToPar}` : scoreToPar}
                <span className="text-faint font-normal"> · par {parPlayed}</span>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-border">
            <div className="text-center">
              <div className="text-lg font-semibold text-primary">
                {fairwayEligible.length > 0 ? `${fairwaysHit}/${fairwayEligible.length}` : '—'}
              </div>
              <div className="text-xs text-muted uppercase">Fairways</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-semibold text-primary">{girsHit}/{holesPlayed}</div>
              <div className="text-xs text-muted uppercase">GIR</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-semibold text-primary">{totalPutts || '—'}</div>
              <div className="text-xs text-muted uppercase">Putts</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-semibold text-primary">
                {totalPutts && holesPlayed ? (totalPutts / holesPlayed).toFixed(1) : '—'}
              </div>
              <div className="text-xs text-muted uppercase">Putts/Hole</div>
            </div>
          </div>

          {conditions && (
            <p className="mt-4 pt-4 border-t border-border text-sm text-tertiary">
              <i className="fas fa-cloud-sun mr-2"></i>
              {conditions}
            </p>
          )}
        </div>

        {/* Scorecard */}
        <div className="bg-surface rounded-lg shadow-sm p-4 sm:p-6">
          <h2 className="text-xl font-bold text-primary mb-4">
            <i className="fas fa-golf-ball mr-2"></i>
            Scorecard
          </h2>
          {holes.length === 0 ? (
            <p className="text-sm text-muted">No hole-by-hole data was recorded for this round.</p>
          ) : (
            <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
              <table className="min-w-full">
                <thead className="bg-surface-muted">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs text-muted uppercase">Hole</th>
                    <th className="px-3 py-2 text-center text-xs text-muted uppercase">Par</th>
                    <th className="px-3 py-2 text-center text-xs text-muted uppercase">Score</th>
                    <th className="px-3 py-2 text-center text-xs text-muted uppercase">+/-</th>
                    <th className="px-3 py-2 text-center text-xs text-muted uppercase">FIR</th>
                    <th className="px-3 py-2 text-center text-xs text-muted uppercase">GIR</th>
                    <th className="px-3 py-2 text-center text-xs text-muted uppercase">Putts</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(editing ? editHoles : holes).map(hole => {
                    if (editing) {
                      const eh = hole as EditableHole;
                      return (
                        <tr key={eh.hole_number}>
                          <td className="px-3 py-2 text-sm font-medium text-primary">{eh.hole_number}</td>
                          <td className="px-3 py-2 text-sm text-primary text-center">{eh.par ?? '—'}</td>
                          <td className="px-2 py-1 text-center">
                            <input
                              type="number"
                              inputMode="numeric"
                              min={1}
                              max={20}
                              value={eh.strokes}
                              onChange={e => updateEditHole(eh.hole_number, { strokes: e.target.value })}
                              className="w-14 min-h-[44px] px-1 py-1 text-center border border-border-strong rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                              aria-label={`Hole ${eh.hole_number} score`}
                            />
                          </td>
                          <td className="px-3 py-2 text-sm text-faint text-center">—</td>
                          <td className="px-2 py-1 text-center">
                            {(eh.par ?? 4) > 3 ? (
                              <button
                                type="button"
                                onClick={() => updateEditHole(eh.hole_number, {
                                  fairway_hit: eh.fairway_hit === true ? false : eh.fairway_hit === false ? null : true,
                                })}
                                className="min-w-[44px] min-h-[44px] rounded-md hover:bg-surface-sunken active:bg-surface-sunken"
                                title="Cycle: hit → missed → n/a"
                                aria-label={`Hole ${eh.hole_number} fairway`}
                              >
                                {eh.fairway_hit === true && <i className="fas fa-check text-green-600 dark:text-green-400"></i>}
                                {eh.fairway_hit === false && <i className="fas fa-times text-red-600 dark:text-red-400"></i>}
                                {eh.fairway_hit === null && <span className="text-faint text-xs">n/a</span>}
                              </button>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>
                          <td className="px-2 py-1 text-center">
                            <button
                              type="button"
                              onClick={() => updateEditHole(eh.hole_number, { green_in_regulation: !eh.green_in_regulation })}
                              className="min-w-[44px] min-h-[44px] rounded-md hover:bg-surface-sunken active:bg-surface-sunken"
                              aria-label={`Hole ${eh.hole_number} green in regulation`}
                            >
                              <i className={`fas ${eh.green_in_regulation ? 'fa-check text-green-600 dark:text-green-400' : 'fa-times text-red-600 dark:text-red-400'}`}></i>
                            </button>
                          </td>
                          <td className="px-2 py-1 text-center">
                            <input
                              type="number"
                              inputMode="numeric"
                              min={0}
                              max={10}
                              value={eh.putts}
                              onChange={e => updateEditHole(eh.hole_number, { putts: e.target.value })}
                              className="w-14 min-h-[44px] px-1 py-1 text-center border border-border-strong rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                              aria-label={`Hole ${eh.hole_number} putts`}
                            />
                          </td>
                        </tr>
                      );
                    }

                    const h = hole as GolfHole;
                    const holeScore = h.par !== null ? h.strokes - h.par : null;
                    return (
                      <tr key={h.hole_number} className="hover:bg-surface-muted">
                        <td className="px-3 py-2 text-sm font-medium text-primary">{h.hole_number}</td>
                        <td className="px-3 py-2 text-sm text-primary text-center">{h.par ?? '—'}</td>
                        <td className="px-3 py-2 text-sm text-primary text-center font-medium">{h.strokes}</td>
                        <td className={`px-3 py-2 text-sm text-center font-medium ${
                          holeScore === null ? 'text-faint'
                            : holeScore === 0 ? 'text-brand-fg'
                            : holeScore > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'
                        }`}>
                          {holeScore === null ? '—' : holeScore === 0 ? 'E' : holeScore > 0 ? `+${holeScore}` : holeScore}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {(h.par ?? 4) > 3 ? (
                            h.fairway_hit === null ? (
                              <span className="text-faint text-xs">n/a</span>
                            ) : (
                              <i className={`fas ${h.fairway_hit ? 'fa-check text-green-600 dark:text-green-400' : 'fa-times text-red-600 dark:text-red-400'}`}></i>
                            )
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <i className={`fas ${h.green_in_regulation ? 'fa-check text-green-600 dark:text-green-400' : 'fa-times text-red-600 dark:text-red-400'}`}></i>
                        </td>
                        <td className="px-3 py-2 text-sm text-primary text-center">{h.putts ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Notes */}
        {round.notes && (
          <div className="bg-surface rounded-lg shadow-sm p-4 sm:p-6">
            <h2 className="text-xl font-bold text-primary mb-4">
              <i className="fas fa-sticky-note mr-2"></i>
              Round Notes
            </h2>
            <p className="text-secondary leading-relaxed break-words">{round.notes}</p>
          </div>
        )}
      </div>

      <ConfirmModal
        isOpen={showDeleteConfirm}
        title="Delete this round?"
        message="The round and its hole-by-hole scores will be permanently deleted. Any post that shared this round will remain, but its scorecard will no longer appear."
        confirmText={deleting ? 'Deleting…' : 'Delete round'}
        confirmButtonClass="bg-red-600 hover:bg-red-700 text-white"
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  );
}
