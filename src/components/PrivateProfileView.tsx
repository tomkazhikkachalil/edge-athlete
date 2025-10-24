'use client';

import { formatDisplayName, getInitials } from '@/lib/formatters';
import LazyImage from './LazyImage';
import FollowButton from './FollowButton';

interface PrivateProfileViewProps {
  profile: {
    id: string;
    full_name?: string; // username/handle
    first_name?: string;
    middle_name?: string;
    last_name?: string;
    avatar_url?: string;
    sport?: string;
    school?: string;
  };
  onFollow?: (isFollowing: boolean) => void;
}

export default function PrivateProfileView({ profile, onFollow }: PrivateProfileViewProps) {
  return (
    <div className="max-w-2xl mx-auto mt-12 px-6">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
        {/* Lock Icon */}
        <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <i className="fas fa-lock text-3xl text-gray-400"></i>
        </div>

        {/* Heading */}
        <h2 className="text-2xl font-bold text-gray-900 mb-3">
          This Profile is Private
        </h2>

        <p className="text-gray-600 mb-8">
          Follow {profile.first_name || 'this athlete'} to see their posts, stats, and activity
        </p>

        {/* Athlete Info (Limited) */}
        <div className="flex items-center justify-center gap-4 mb-8">
          {profile.avatar_url ? (
            <LazyImage
              src={profile.avatar_url}
              alt={formatDisplayName(profile.first_name, null, profile.last_name, profile.full_name)}
              className="w-16 h-16 rounded-full object-cover"
              width={64}
              height={64}
            />
          ) : (
            <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
              <span className="text-white text-xl font-semibold">
                {getInitials(formatDisplayName(profile.first_name, null, profile.last_name, profile.full_name))}
              </span>
            </div>
          )}

          <div className="text-left">
            <div className="font-bold text-lg text-gray-900">
              {formatDisplayName(profile.first_name, null, profile.last_name, profile.full_name)}
            </div>
            {profile.sport && (
              <div className="text-gray-600 text-sm">
                {profile.sport}
                {profile.school && ` • ${profile.school}`}
              </div>
            )}
          </div>
        </div>

        {/* Follow Button */}
        <div className="flex justify-center">
          <FollowButton
            profileId={profile.id}
            size="lg"
            onFollowChange={(isFollowing) => {
              onFollow?.(isFollowing);
            }}
          />
        </div>

        {/* Info Note */}
        <div className="mt-8 p-4 bg-blue-50 border border-blue-100 rounded-lg">
          <div className="flex items-start gap-2 text-left">
            <i className="fas fa-info-circle text-blue-600 mt-0.5 flex-shrink-0"></i>
            <p className="text-sm text-blue-900">
              This athlete has a private profile. Once they accept your follow request,
              you&apos;ll be able to view their posts, stats, and all profile content.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
