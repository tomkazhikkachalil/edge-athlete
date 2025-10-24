'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { getSportAdapter } from '@/lib/sports';

interface GolfRound {
  id: string;
  date: string;
  course: string;
  score: number;
  par: number;
  holes: Array<{
    hole: number;
    par: number;
    strokes: number;
    fairway?: boolean;
    gir?: boolean;
    putts?: number;
  }>;
  notes?: string;
}

export default function GolfRoundDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [round, setRound] = useState<GolfRound | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const roundId = params.roundId as string;

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
      return;
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    const loadRoundDetail = async () => {
      if (!user?.id || !roundId) return;

      try {
        // TODO: Replace with actual API call to get round details
        // const response = await fetch(`/api/golf/rounds/${roundId}`);
        // if (!response.ok) {
        //   setNotFound(true);
        //   return;
        // }
        // const roundData = await response.json();
        // setRound(roundData);
        
        // For now, show sample round data
        const golfAdapter = getSportAdapter('golf');
        if (golfAdapter.isEnabled()) {
          setTimeout(() => {
            setRound({
              id: roundId,
              date: '2024-03-15',
              course: 'Pebble Beach Golf Links',
              score: 82,
              par: 72,
              holes: Array.from({ length: 18 }, (_, i) => ({
                hole: i + 1,
                par: i < 4 ? 4 : i < 14 ? [4, 3, 5][i % 3] : 4,
                strokes: Math.floor(Math.random() * 3) + 3,
                fairway: Math.random() > 0.3,
                gir: Math.random() > 0.4,
                putts: Math.floor(Math.random() * 2) + 2,
              })),
              notes: 'Great day on the course! Weather was perfect and I played well from the tee.'
            });
            setLoading(false);
          }, 800);
        } else {
          setNotFound(true);
          setLoading(false);
        }
        
      } catch {
        setNotFound(true);
        setLoading(false);
      }
    };

    if (user?.id) {
      loadRoundDetail();
    }
  }, [user?.id, roundId]);

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-2 text-gray-600">Loading round details...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return null; // Will redirect
  }

  if (notFound || !round) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Round Not Found</h1>
          <p className="text-gray-600 mb-8">This golf round does not exist or you don&apos;t have access to it.</p>
          <button
            onClick={() => router.back()}
            className="inline-flex items-center px-4 py-2 border border-transparent text-base font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 transition-colors"
          >
            <i className="fas fa-arrow-left mr-2"></i>
            Go Back
          </button>
        </div>
      </div>
    );
  }

  const scoreToPar = round.score - round.par;
  const fairwaysHit = round.holes.filter(h => h.fairway).length;
  const girsHit = round.holes.filter(h => h.gir).length;
  const totalPutts = round.holes.reduce((sum, h) => sum + (h.putts || 0), 0);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navigation */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <button
              onClick={() => router.back()}
              className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900 transition-colors"
            >
              <i className="fas fa-arrow-left mr-2"></i>
              Back to Activity
            </button>
            <div className="flex items-center space-x-4">
              <button
                className="inline-flex items-center px-3 py-1 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 transition-colors"
                title="Edit round"
              >
                <i className="fas fa-edit mr-1"></i>
                Edit
              </button>
              <button
                className="inline-flex items-center px-3 py-1 border border-red-300 rounded-md text-sm font-medium text-red-700 bg-white hover:bg-red-50 transition-colors"
                title="Delete round"
              >
                <i className="fas fa-trash mr-1"></i>
                Delete
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-section space-y-6">
        {/* Round Header */}
        <div className="bg-white rounded-lg shadow-sm p-base">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h1 className="text-h1 text-gray-900 mb-2">{round.course}</h1>
              <p className="text-gray-600">
                <i className="fas fa-calendar mr-2"></i>
                {new Date(round.date).toLocaleDateString('en-US', { 
                  weekday: 'long', 
                  year: 'numeric', 
                  month: 'long', 
                  day: 'numeric' 
                })}
              </p>
            </div>
            <div className="text-right">
              <div className="text-h1 text-gray-900">{round.score}</div>
              <div className={`text-sm font-medium ${
                scoreToPar === 0 ? 'text-blue-600' : 
                scoreToPar > 0 ? 'text-red-600' : 'text-green-600'
              }`}>
                {scoreToPar === 0 ? 'E' : scoreToPar > 0 ? `+${scoreToPar}` : scoreToPar}
              </div>
            </div>
          </div>
          
          {/* Round Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-gray-200">
            <div className="text-center">
              <div className="text-h3 text-gray-900">{fairwaysHit}/14</div>
              <div className="text-chip text-gray-500 uppercase">Fairways</div>
            </div>
            <div className="text-center">
              <div className="text-h3 text-gray-900">{girsHit}/18</div>
              <div className="text-chip text-gray-500 uppercase">GIR</div>
            </div>
            <div className="text-center">
              <div className="text-h3 text-gray-900">{totalPutts}</div>
              <div className="text-chip text-gray-500 uppercase">Putts</div>
            </div>
            <div className="text-center">
              <div className="text-h3 text-gray-900">{(totalPutts / 18).toFixed(1)}</div>
              <div className="text-chip text-gray-500 uppercase">Putts/Hole</div>
            </div>
          </div>
        </div>

        {/* Scorecard */}
        <div className="bg-white rounded-lg shadow-sm p-base">
          <h2 className="text-h2 text-gray-900 mb-4">
            <i className="fas fa-golf-ball mr-2"></i>
            Scorecard
          </h2>
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs text-gray-500 uppercase">Hole</th>
                  <th className="px-3 py-2 text-center text-xs text-gray-500 uppercase">Par</th>
                  <th className="px-3 py-2 text-center text-xs text-gray-500 uppercase">Score</th>
                  <th className="px-3 py-2 text-center text-xs text-gray-500 uppercase">+/-</th>
                  <th className="px-3 py-2 text-center text-xs text-gray-500 uppercase">FIR</th>
                  <th className="px-3 py-2 text-center text-xs text-gray-500 uppercase">GIR</th>
                  <th className="px-3 py-2 text-center text-xs text-gray-500 uppercase">Putts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {round.holes.map((hole) => {
                  const holeScore = hole.strokes - hole.par;
                  return (
                    <tr key={hole.hole} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-sm font-medium text-gray-900">{hole.hole}</td>
                      <td className="px-3 py-2 text-sm text-gray-900 text-center">{hole.par}</td>
                      <td className="px-3 py-2 text-sm text-gray-900 text-center font-medium">{hole.strokes}</td>
                      <td className={`px-3 py-2 text-sm text-center font-medium ${
                        holeScore === 0 ? 'text-blue-600' : 
                        holeScore > 0 ? 'text-red-600' : 'text-green-600'
                      }`}>
                        {holeScore === 0 ? 'E' : holeScore > 0 ? `+${holeScore}` : holeScore}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {hole.par > 3 && (
                          <i className={`fas ${hole.fairway ? 'fa-check text-green-600' : 'fa-times text-red-600'}`}></i>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <i className={`fas ${hole.gir ? 'fa-check text-green-600' : 'fa-times text-red-600'}`}></i>
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-900 text-center">{hole.putts}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Notes */}
        {round.notes && (
          <div className="bg-white rounded-lg shadow-sm p-base">
            <h2 className="text-h2 text-gray-900 mb-4">
              <i className="fas fa-sticky-note mr-2"></i>
              Round Notes
            </h2>
            <p className="text-gray-700 leading-relaxed">{round.notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}