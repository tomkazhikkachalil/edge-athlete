'use client';

import { useState, useEffect } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { useRouter } from 'next/navigation';
import LazyImage from './LazyImage';
import ConfirmModal from './ConfirmModal';
import CommentSection from './CommentSection';
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
  tags?: string[];
  hashtags?: string[];
  golf_round?: any;
}

interface PostCardProps {
  post: Post;
  currentUserId?: string;
  onLike?: (postId: string) => void;
  onComment?: (postId: string) => void;
  onDelete?: (postId: string) => void;
  onCommentCountChange?: (postId: string, newCount: number) => void;
  showActions?: boolean;
}

export default function PostCard({
  post,
  currentUserId,
  onLike,
  onComment,
  onDelete,
  onCommentCountChange,
  showActions = true
}: PostCardProps) {
  const router = useRouter();
  const [currentMediaIndex, setCurrentMediaIndex] = useState(0);
  const [isLiked, setIsLiked] = useState(
    post.likes?.some(like => like.profile_id === currentUserId) || false
  );
  const [localLikesCount, setLocalLikesCount] = useState(post.likes_count);
  const [localCommentsCount, setLocalCommentsCount] = useState(post.comments_count);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Update local likes count when post prop changes (but not isLiked - that's managed by user interaction)
  useEffect(() => {
    setLocalLikesCount(post.likes_count);
  }, [post.likes_count]);

  // Update local comments count when post prop changes
  useEffect(() => {
    setLocalCommentsCount(post.comments_count);
  }, [post.comments_count]);

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
      // Optimistically update UI immediately for better UX
      const newIsLiked = !isLiked;
      setIsLiked(newIsLiked);
      setLocalLikesCount(newIsLiked ? localLikesCount + 1 : localLikesCount - 1);

      // Call parent handler which will update with actual count from server
      onLike(post.id);
    }
  };

  const handleComment = () => {
    if (onComment) {
      onComment(post.id);
    }
  };

  const handleCommentCountChange = (newCount: number) => {
    setLocalCommentsCount(newCount);
    if (onCommentCountChange) {
      onCommentCountChange(post.id, newCount);
    }
  };

  const handleDeleteClick = () => {
    setShowDeleteConfirm(true);
  };

  const handleDeleteConfirm = () => {
    if (onDelete) {
      onDelete(post.id);
    }
    setShowDeleteConfirm(false);
  };

  const handleDeleteCancel = () => {
    setShowDeleteConfirm(false);
  };

  const isOwner = currentUserId === post.profile.id;

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
          onClick={() => {
            // Navigate to own profile page if viewing own post, otherwise to athlete's profile
            if (currentUserId === post.profile.id) {
              router.push('/athlete');
            } else {
              router.push(`/athlete/${post.profile.id}`);
            }
          }}
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

        <div className="flex items-center gap-2">
          {/* Privacy indicator */}
          {post.visibility === 'private' && (
            <div className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
              Private
            </div>
          )}

          {/* Delete button - only show for post owner */}
          {isOwner && (
            <button
              onClick={handleDeleteClick}
              className="text-gray-400 hover:text-red-600 transition-colors p-2 rounded-full hover:bg-red-50"
              title="Delete post"
            >
              <i className="fas fa-trash text-sm"></i>
            </button>
          )}
        </div>
      </div>

      {/* Media */}
      {post.media && post.media.length > 0 && (
        <div className="relative bg-gray-100">
          <div className="relative w-full">
            {post.media[currentMediaIndex].media_type === 'image' ? (
              <LazyImage
                src={post.media[currentMediaIndex].media_url}
                alt="Post media"
                className="w-full h-auto object-contain"
                width={600}
                height={600}
                style={{ maxHeight: '600px' }}
              />
            ) : (
              <video
                src={post.media[currentMediaIndex].media_url}
                className="w-full h-auto"
                style={{ maxHeight: '600px' }}
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
              <span>{localLikesCount}</span>
            </button>
            
            <button
              onClick={handleComment}
              className="flex items-center gap-1 text-sm text-gray-600 hover:text-blue-500 transition-colors"
            >
              <i className="far fa-comment"></i>
              <span>{localCommentsCount}</span>
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

        {/* Hashtags */}
        {post.hashtags && post.hashtags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-micro">
            {post.hashtags.map((hashtag, index) => (
              <span
                key={index}
                className="text-blue-600 hover:text-blue-700 cursor-pointer text-sm"
              >
                {hashtag}
              </span>
            ))}
          </div>
        )}

        {/* Tags */}
        {post.tags && post.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-micro">
            {post.tags.map((tag, index) => (
              <span
                key={index}
                className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded-full font-medium"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Golf Round Data */}
        {post.sport_key === 'golf' && post.golf_round && (
          <div className="bg-green-50 rounded-lg p-micro mt-micro border border-green-200">
            <div className="flex items-center gap-1 text-xs text-green-700 mb-1">
              <i className="fas fa-golf-ball"></i>
              <span className="font-medium">Golf Round</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-green-800">
              {post.golf_round.course && (
                <div>
                  <span className="font-medium">Course:</span> {post.golf_round.course}
                </div>
              )}
              {post.golf_round.gross_score && (
                <div>
                  <span className="font-medium">Score:</span> {post.golf_round.gross_score}
                  {post.golf_round.par && ` (${post.golf_round.gross_score - post.golf_round.par >= 0 ? '+' : ''}${post.golf_round.gross_score - post.golf_round.par})`}
                </div>
              )}
              {post.golf_round.total_putts && (
                <div>
                  <span className="font-medium">Putts:</span> {post.golf_round.total_putts}
                </div>
              )}
              {post.golf_round.fir_percentage !== null && (
                <div>
                  <span className="font-medium">FIR:</span> {Math.round(post.golf_round.fir_percentage)}%
                </div>
              )}
              {post.golf_round.gir_percentage !== null && (
                <div>
                  <span className="font-medium">GIR:</span> {Math.round(post.golf_round.gir_percentage)}%
                </div>
              )}
              {post.golf_round.holes && (
                <div>
                  <span className="font-medium">Holes:</span> {post.golf_round.holes}
                </div>
              )}
            </div>
          </div>
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

      {/* Comments Section */}
      <CommentSection
        postId={post.id}
        initialCommentsCount={post.comments_count}
        onCommentCountChange={handleCommentCountChange}
      />

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={showDeleteConfirm}
        title="Delete Post"
        message="Are you sure you want to permanently delete this post? This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        confirmButtonClass="bg-red-600 hover:bg-red-700"
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
      />
    </div>
  );
}