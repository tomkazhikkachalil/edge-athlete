'use client';

import { useState } from 'react';
import { formatDisplayName } from '@/lib/formatters';
import type { GroupPost, GolfScorecardData, Profile } from '@/types/group-posts';

interface ParticipantAttestationModalProps {
  groupPost: GroupPost & { creator?: Profile };
  golfData: GolfScorecardData;
  onConfirm: () => Promise<void>;
  onDecline: () => Promise<void>;
  onClose: () => void;
}

export default function ParticipantAttestationModal({
  groupPost,
  golfData,
  onConfirm,
  onDecline,
  onClose
}: ParticipantAttestationModalProps) {
  const [processing, setProcessing] = useState(false);
  const [action, setAction] = useState<'confirm' | 'decline' | null>(null);

  const creatorName = groupPost.creator
    ? formatDisplayName(
        groupPost.creator.first_name,
        null,
        groupPost.creator.last_name,
        groupPost.creator.full_name
      )
    : 'Unknown';

  const formattedDate = new Date(groupPost.date).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });

  const handleConfirm = async () => {
    setProcessing(true);
    setAction('confirm');
    try {
      await onConfirm();
      onClose();
    } catch (error) {
      console.error('Failed to confirm participation:', error);
      setProcessing(false);
      setAction(null);
    }
  };

  const handleDecline = async () => {
    setProcessing(true);
    setAction('decline');
    try {
      await onDecline();
      onClose();
    } catch (error) {
      console.error('Failed to decline participation:', error);
      setProcessing(false);
      setAction(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="bg-white rounded-lg shadow-2xl max-w-lg w-full overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-green-600 to-green-700 text-white p-6">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <i className="fas fa-golf-ball text-2xl"></i>
                <h2 className="text-2xl font-black">Round Invitation</h2>
              </div>
              <p className="text-sm font-semibold opacity-90">
                You've been invited to join a golf round
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-white hover:text-gray-200 text-xl font-bold ml-4"
            >
              <i className="fas fa-times"></i>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Invitation Details */}
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
            <div className="flex items-center gap-2 mb-3">
              <i className="fas fa-user-circle text-green-600"></i>
              <div>
                <span className="text-sm text-gray-600">Invited by</span>
                <div className="font-bold text-gray-900">{creatorName}</div>
              </div>
            </div>

            <div className="space-y-2 text-sm">
              <div className="flex items-start gap-2">
                <i className="fas fa-map-marker-alt text-green-600 mt-0.5"></i>
                <div>
                  <span className="font-semibold text-gray-900">{golfData.course_name}</span>
                  {golfData.round_type === 'indoor' ? (
                    <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 bg-blue-600 text-white text-xs font-bold rounded-full">
                      <i className="fas fa-warehouse text-[8px]"></i>
                      INDOOR
                    </span>
                  ) : (
                    <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 bg-green-600 text-white text-xs font-bold rounded-full">
                      <i className="fas fa-tree text-[8px]"></i>
                      OUTDOOR
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <i className="fas fa-calendar text-green-600"></i>
                <span className="text-gray-900">{formattedDate}</span>
              </div>

              <div className="flex items-center gap-2">
                <i className="fas fa-flag text-green-600"></i>
                <span className="text-gray-900">{golfData.holes_played} Holes</span>
              </div>

              {golfData.tee_color && (
                <div className="flex items-center gap-2">
                  <i className="fas fa-tint text-green-600"></i>
                  <span className="text-gray-900">
                    {golfData.tee_color.charAt(0).toUpperCase() + golfData.tee_color.slice(1)} Tees
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Description */}
          {groupPost.description && (
            <div className="mb-6">
              <h3 className="font-bold text-gray-900 mb-2">Details:</h3>
              <p className="text-sm text-gray-700">{groupPost.description}</p>
            </div>
          )}

          {/* What Happens Next */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <h3 className="font-bold text-blue-900 mb-2 flex items-center gap-2">
              <i className="fas fa-info-circle"></i>
              What happens next?
            </h3>
            <ul className="text-sm text-blue-900 space-y-1">
              <li className="flex items-start gap-2">
                <i className="fas fa-check text-blue-600 mt-0.5"></i>
                <span>If you <strong>confirm</strong>, you'll be able to add your scores and appear on the shared scorecard</span>
              </li>
              <li className="flex items-start gap-2">
                <i className="fas fa-times text-red-600 mt-0.5"></i>
                <span>If you <strong>decline</strong>, you won't be included in the round</span>
              </li>
            </ul>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleDecline}
              disabled={processing}
              className="flex-1 bg-gray-600 hover:bg-gray-700 disabled:bg-gray-400 disabled:cursor-not-allowed text-white font-bold py-3 px-6 rounded-lg transition-colors"
            >
              {processing && action === 'decline' ? (
                <>
                  <i className="fas fa-spinner fa-spin mr-2"></i>
                  Declining...
                </>
              ) : (
                <>
                  <i className="fas fa-times-circle mr-2"></i>
                  Decline
                </>
              )}
            </button>

            <button
              onClick={handleConfirm}
              disabled={processing}
              className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-green-400 disabled:cursor-not-allowed text-white font-bold py-3 px-6 rounded-lg transition-colors"
            >
              {processing && action === 'confirm' ? (
                <>
                  <i className="fas fa-spinner fa-spin mr-2"></i>
                  Confirming...
                </>
              ) : (
                <>
                  <i className="fas fa-check-circle mr-2"></i>
                  Confirm & Join
                </>
              )}
            </button>
          </div>

          {/* Maybe Option (Future Enhancement) */}
          <div className="mt-3 text-center">
            <button
              onClick={onClose}
              disabled={processing}
              className="text-sm text-gray-600 hover:text-gray-800 font-semibold disabled:text-gray-400 disabled:cursor-not-allowed"
            >
              I'll decide later
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
