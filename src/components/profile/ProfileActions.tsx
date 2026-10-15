'use client';

import type { ReactNode } from 'react';
import FollowButton from '@/components/FollowButton';

/**
 * The matched pair at the end of a profile's stats row (Tom, Oct 14 2026):
 * [Message] [Become a Fan] — one look, one height, side by side. Follow and
 * Fan are ONE relationship here (FollowButton: Become a Fan → Fan /
 * Requested, tap again to undo), so the pair is Message + the fan button.
 * `messageSlot` is filled by MessageButton (the Message door); the row is
 * laid out for two from the start. Rendered only for a signed-in viewer who
 * is not the owner (the callers decide). At a phone width the pair takes its
 * own full-width line under the counts; from `sm` it sits at the row's end.
 */
interface ProfileActionsProps {
  profileId: string;
  currentUserId?: string;
  onFollowChange?: (isFollowing: boolean, followersCount: number) => void;
  onStatsLoaded?: (stats: { followersCount: number; followingCount?: number; isFollowing: boolean; followStatus: string | null; isPrivate?: boolean }) => void;
  messageSlot?: ReactNode;
  className?: string;
}

export default function ProfileActions({ profileId, currentUserId, onFollowChange, onStatsLoaded, messageSlot, className = '' }: ProfileActionsProps) {
  return (
    <div className={`flex items-center gap-2 w-full sm:w-auto sm:ml-auto ${className}`} data-profile-actions="">
      {messageSlot && <div className="flex-1 sm:flex-none min-w-0">{messageSlot}</div>}
      <div className="flex-1 sm:flex-none min-w-0">
        <FollowButton
          profileId={profileId}
          currentUserId={currentUserId}
          onFollowChange={onFollowChange}
          onStatsLoaded={onStatsLoaded}
          size="md"
          className="w-full sm:w-auto"
        />
      </div>
    </div>
  );
}
