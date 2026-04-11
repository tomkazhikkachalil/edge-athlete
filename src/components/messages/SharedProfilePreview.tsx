'use client';

import { useRouter } from 'next/navigation';
import LazyImage from '@/components/LazyImage';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import type { SharedProfilePreviewData } from '@/types/messages';

interface Props {
  profile: SharedProfilePreviewData;
  onClick?: () => void;
}

export default function SharedProfilePreview({ profile, onClick }: Props) {
  const router = useRouter();
  const displayName = formatDisplayName(
    profile.first_name,
    null,
    profile.last_name,
    profile.full_name
  );

  const handleClick = () => {
    if (onClick) {
      onClick();
    } else if (profile.handle) {
      router.push(`/u/${profile.handle}`);
    } else {
      router.push(`/athlete/${profile.id}`);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="w-full text-left rounded-lg border border-gray-200 bg-gray-50 hover:bg-gray-100 transition-colors p-3"
    >
      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-2">
        <i className="fas fa-user-circle"></i>
        <span>Shared profile</span>
      </div>
      <div className="flex items-center gap-3">
        {profile.avatar_url ? (
          <LazyImage
            src={profile.avatar_url}
            alt={displayName}
            className="w-10 h-10 rounded-full object-cover shrink-0"
            width={40}
            height={40}
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center text-white text-sm font-bold shrink-0">
            {getInitials(displayName)}
          </div>
        )}
        <div className="min-w-0">
          <p className="font-semibold text-sm text-gray-900 truncate">{displayName}</p>
          {profile.handle && (
            <p className="text-xs text-gray-500 truncate">@{profile.handle}</p>
          )}
          {profile.sport && (
            <span className="inline-block text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded mt-0.5">
              {profile.sport}
            </span>
          )}
          {profile.bio && (
            <p className="text-xs text-gray-600 line-clamp-1 mt-0.5">{profile.bio}</p>
          )}
        </div>
      </div>
    </button>
  );
}
