'use client';

import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { useRouter } from 'next/navigation';
import LazyImage from './LazyImage';
import { getSportName, getSportIcon, getSportColor } from '@/lib/config/sports-config';
import { formatDisplayName, getInitials } from '@/lib/formatters';

interface PostMedia {
  id: string;
  media_url: string;
  media_type: 'image' | 'video';
  display_order: number;
}

interface Profile {
  id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  avatar_url: string | null;
}

interface Post {
  id: string;
  caption: string | null;
  sport_key: string | null;
  stats_data: any;
  visibility: string;
  created_at: string;
  likes_count: number;
  comments_count: number;
  profile: Profile;
  media: PostMedia[];
  likes?: { profile_id: string }[];
}

interface PostCardProps {
  post: Post;
  currentUserId?: string;
  onLike?: (postId: string) => void;
  onComment?: (postId: string) => void;
  showActions?: boolean;
}

export default function PostCard({ 
  post, 
  currentUserId, 
  onLike, 
  onComment, 
  showActions = true 
}: PostCardProps) {
  const router = useRouter();
  const [currentMediaIndex, setCurrentMediaIndex] = useState(0);
  const [isLiked, setIsLiked] = useState(
    post.likes?.some(like => like.profile_id === currentUserId) || false
  );

  const displayName = formatDisplayName(
    post.profile.full_name,
    post.profile.first_name,
    post.profile.last_name
  );

  const timeAgo = formatDistanceToNow(new Date(post.created_at), { addSuffix: true });

  const SportIcon = post.sport_key ? getSportIcon(post.sport_key) : null;
  const sportColor = post.sport_key ? getSportColor(post.sport_key) : '#6B7280';

  const handleLike = () => {
    if (onLike) {
      onLike(post.id);
      setIsLiked(!isLiked);
    }
  };

  const handleComment = () => {
    if (onComment) {
      onComment(post.id);
    }
  };

  const nextMedia = () => {
    if (post.media.length > 1) {
      setCurrentMediaIndex((prev) => (prev + 1) % post.media.length);
    }
  };

  const prevMedia = () => {
    if (post.media.length > 1) {
      setCurrentMediaIndex((prev) => (prev - 1 + post.media.length) % post.media.length);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="p-base flex items-center justify-between">
        <button 
          onClick={() => router.push(`/athlete/${post.profile.id}`)}
          className="flex items-center gap-micro hover:bg-gray-50 p-1 rounded-lg transition-colors"
        >
          {/* Profile Avatar */}
          {post.profile.avatar_url ? (
            <LazyImage
              src={post.profile.avatar_url}
              alt={`${displayName} avatar`}
              className="w-10 h-10 rounded-full object-cover"
              width={40}
              height={40}
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center">
              <span className="text-sm font-medium text-gray-600">
                {getInitials(displayName)}
              </span>
            </div>
          )}
          
          <div>
            <h3 className="font-semibold text-gray-900 text-sm hover:text-blue-600 transition-colors">{displayName}</h3>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span>{timeAgo}</span>
              {post.sport_key && (
                <>
                  <span>•</span>
                  <div className="flex items-center gap-1">
                    {SportIcon && <SportIcon size={12} style={{ color: sportColor }} />}
                    <span>{getSportName(post.sport_key)}</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </button>

        {/* Privacy indicator */}
        {post.visibility === 'private' && (
          <div className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
            Private
          </div>
        )}
      </div>

      {/* Media */}
      {post.media && post.media.length > 0 && (
        <div className="relative">
          <div className="aspect-square bg-gray-100">
            {post.media[currentMediaIndex].media_type === 'image' ? (
              <LazyImage
                src={post.media[currentMediaIndex].media_url}
                alt="Post media"
                className="w-full h-full object-cover"
                width={600}
                height={600}
              />
            ) : (
              <video
                src={post.media[currentMediaIndex].media_url}
                className="w-full h-full object-cover"
                controls
              />
            )}
          </div>

          {/* Media Navigation */}
          {post.media.length > 1 && (
            <>
              <button
                onClick={prevMedia}
                className="absolute left-2 top-1/2 transform -translate-y-1/2 bg-black bg-opacity-50 text-white rounded-full w-8 h-8 flex items-center justify-center hover:bg-opacity-70"
              >
                <i className="fas fa-chevron-left text-sm"></i>
              </button>
              <button
                onClick={nextMedia}
                className="absolute right-2 top-1/2 transform -translate-y-1/2 bg-black bg-opacity-50 text-white rounded-full w-8 h-8 flex items-center justify-center hover:bg-opacity-70"
              >
                <i className="fas fa-chevron-right text-sm"></i>
              </button>
              
              {/* Media indicators */}
              <div className="absolute bottom-2 left-1/2 transform -translate-x-1/2 flex gap-1">
                {post.media.map((_, index) => (
                  <div
                    key={index}
                    className={`w-2 h-2 rounded-full ${
                      index === currentMediaIndex ? 'bg-white' : 'bg-white bg-opacity-50'
                    }`}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Actions */}
      {showActions && (
        <div className="px-base py-micro border-b border-gray-100">
          <div className="flex items-center gap-base">
            <button
              onClick={handleLike}
              className={`flex items-center gap-1 text-sm transition-colors ${
                isLiked ? 'text-red-500' : 'text-gray-600 hover:text-red-500'
              }`}
            >
              <i className={`${isLiked ? 'fas' : 'far'} fa-heart`}></i>
              <span>{post.likes_count}</span>
            </button>
            
            <button
              onClick={handleComment}
              className="flex items-center gap-1 text-sm text-gray-600 hover:text-blue-500 transition-colors"
            >
              <i className="far fa-comment"></i>
              <span>{post.comments_count}</span>
            </button>
            
            <button className="flex items-center gap-1 text-sm text-gray-600 hover:text-green-500 transition-colors">
              <i className="far fa-share"></i>
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="p-base">
        {/* Caption */}
        {post.caption && (
          <p className="text-gray-900 text-sm mb-micro">{post.caption}</p>
        )}

        {/* Sport Stats */}
        {post.stats_data && post.sport_key === 'golf' && (
          <div className="bg-gray-50 rounded-lg p-micro mt-micro">
            <div className="text-xs text-gray-600 mb-1">Golf Stats</div>
            {post.stats_data.type === 'round_recap' && (
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="font-medium">Score:</span> {post.stats_data.grossScore}
                </div>
                {post.stats_data.course && (
                  <div>
                    <span className="font-medium">Course:</span> {post.stats_data.course}
                  </div>
                )}
                {post.stats_data.firPercentage && (
                  <div>
                    <span className="font-medium">FIR:</span> {Math.round(post.stats_data.firPercentage)}%
                  </div>
                )}
                {post.stats_data.totalPutts && (
                  <div>
                    <span className="font-medium">Putts:</span> {post.stats_data.totalPutts}
                  </div>
                )}
              </div>
            )}
            {post.stats_data.type === 'hole_highlight' && (
              <div className="text-xs">
                <span className="font-medium">Hole {post.stats_data.holeNumber}:</span> 
                {' '}{post.stats_data.score} on Par {post.stats_data.par}
                {post.stats_data.club && (
                  <span> • {post.stats_data.club}</span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}