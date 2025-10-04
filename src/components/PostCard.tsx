'use client';

import { useState, useEffect, useCallback } from 'react';
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
  onEdit?: (postId: string) => void;
  onCommentCountChange?: (postId: string, newCount: number) => void;
  showActions?: boolean;
}

export default function PostCard({
  post,
  currentUserId,
  onLike,
  onComment,
  onDelete,
  onEdit,
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

  // Update isLiked state when post.likes array changes
  useEffect(() => {
    setIsLiked(post.likes?.some(like => like.profile_id === currentUserId) || false);
  }, [post.likes, currentUserId]);

  // Update local likes count when post prop changes
  useEffect(() => {
    setLocalLikesCount(post.likes_count);
  }, [post.likes_count]);

  // Update local comments count when post prop changes
  useEffect(() => {
    setLocalCommentsCount(post.comments_count);
  }, [post.comments_count]);

  const displayName = formatDisplayName(
    post.profile.first_name,
    post.profile.middle_name,
    post.profile.last_name,
    post.profile.full_name
  );

  const timeAgo = formatDistanceToNow(new Date(post.created_at), { addSuffix: true });

  const SportIcon = post.sport_key ? getSportIcon(post.sport_key) : null;
  const sportColor = post.sport_key ? getSportColor(post.sport_key) : '#6B7280';

  const handleLike = () => {
    if (onLike) {
      // Only optimistically update the heart icon, not the count
      // The count will be updated from the server response via props
      setIsLiked(!isLiked);

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
    <div className="bg-white rounded-lg shadow-md border-2 border-gray-300 overflow-hidden mb-6">
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

          {/* Edit and Delete buttons - only show for post owner */}
          {isOwner && (
            <>
              <button
                onClick={() => onEdit?.(post.id)}
                className="text-gray-400 hover:text-blue-600 transition-colors p-2 rounded-full hover:bg-blue-50"
                title="Edit post"
              >
                <i className="fas fa-edit text-sm"></i>
              </button>
              <button
                onClick={handleDeleteClick}
                className="text-gray-400 hover:text-red-600 transition-colors p-2 rounded-full hover:bg-red-50"
                title="Delete post"
              >
                <i className="fas fa-trash text-sm"></i>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Media */}
      {post.media && post.media.length > 0 && (
        <div className="relative bg-black">
          <div className="relative w-full flex items-center justify-center">
            {post.media[currentMediaIndex].media_type === 'image' ? (
              <LazyImage
                src={post.media[currentMediaIndex].media_url}
                alt="Post media"
                className="w-full h-auto object-cover mx-auto"
                width={600}
                height={600}
                style={{ maxHeight: '500px' }}
              />
            ) : (
              <video
                src={post.media[currentMediaIndex].media_url}
                className="w-full h-auto mx-auto"
                style={{ maxHeight: '500px' }}
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

        {/* Golf Round Data - Compact View */}
        {post.sport_key === 'golf' && post.golf_round && (
          <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-3 mt-2 border border-green-200">
            {/* Compact Header with Score */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <i className="fas fa-golf-ball text-green-600 text-sm"></i>
                  <span className="font-bold text-green-900 text-sm">{post.golf_round.course}</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-green-700">
                  {post.golf_round.date && (
                    <span>{new Date(post.golf_round.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                  )}
                  {post.golf_round.tee && <span>• {post.golf_round.tee} Tees</span>}
                  {post.golf_round.holes && <span>• {post.golf_round.holes} Holes</span>}
                </div>
              </div>

              {/* Large Score Badge */}
              {post.golf_round.gross_score !== null && post.golf_round.gross_score !== undefined && (
                <div className="text-right ml-3">
                  <div className="bg-white rounded-lg px-3 py-1 shadow-sm">
                    <div className="text-2xl font-bold text-green-900 leading-none">{post.golf_round.gross_score}</div>
                    {post.golf_round.par && (
                      <div className={`text-xs font-medium ${post.golf_round.gross_score - post.golf_round.par < 0 ? 'text-blue-600' : 'text-red-600'}`}>
                        {post.golf_round.gross_score - post.golf_round.par >= 0 ? '+' : ''}{post.golf_round.gross_score - post.golf_round.par}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Inline Stats Bar */}
            {(post.golf_round.total_putts || post.golf_round.fir_percentage !== null || post.golf_round.gir_percentage !== null) && (
              <div className="flex items-center gap-4 text-xs bg-white/50 rounded px-3 py-1.5 mb-2">
                {post.golf_round.total_putts && (
                  <div className="flex items-center gap-1">
                    <span className="text-green-700">Putts:</span>
                    <span className="font-semibold text-green-900">{post.golf_round.total_putts}</span>
                  </div>
                )}
                {post.golf_round.fir_percentage !== null && post.golf_round.fir_percentage !== undefined && (
                  <div className="flex items-center gap-1">
                    <span className="text-green-700">FIR:</span>
                    <span className="font-semibold text-green-900">{Math.round(post.golf_round.fir_percentage)}%</span>
                  </div>
                )}
                {post.golf_round.gir_percentage !== null && post.golf_round.gir_percentage !== undefined && (
                  <div className="flex items-center gap-1">
                    <span className="text-green-700">GIR:</span>
                    <span className="font-semibold text-green-900">{Math.round(post.golf_round.gir_percentage)}%</span>
                  </div>
                )}
              </div>
            )}

            {/* Collapsible Traditional Scorecard */}
            {post.golf_round.golf_holes && post.golf_round.golf_holes.length > 0 && (
              <details className="group">
                <summary className="cursor-pointer text-xs font-medium text-green-700 hover:text-green-900 flex items-center gap-1 py-1">
                  <i className="fas fa-chevron-right group-open:rotate-90 transition-transform text-[10px]"></i>
                  View Scorecard ({post.golf_round.golf_holes.length} holes)
                </summary>
                <div className="mt-3">
                  {/* Traditional Scorecard Layout */}
                  <div className="bg-white rounded border border-gray-300 overflow-hidden">
                    {/* Front 9 */}
                    {post.golf_round.golf_holes.filter((h: any) => h.hole_number <= 9).length > 0 && (
                      <div className="border-b-2 border-gray-400">
                        <table className="w-full text-[10px]">
                          <thead>
                            <tr className="bg-green-100 border-b border-gray-300">
                              <th className="text-left py-1 px-2 font-semibold text-green-900">HOLE</th>
                              {post.golf_round.golf_holes
                                .filter((h: any) => h.hole_number <= 9)
                                .map((hole: any) => (
                                  <th key={hole.hole_number} className="text-center py-1 px-1 font-bold text-green-900">
                                    {hole.hole_number}
                                  </th>
                                ))}
                              <th className="text-center py-1 px-2 font-bold text-green-900 bg-green-200">OUT</th>
                            </tr>
                          </thead>
                          <tbody>
                            {/* Yardage Row */}
                            <tr className="border-b border-gray-200 bg-gray-50">
                              <td className="py-1 px-2 font-medium text-gray-700">YDS</td>
                              {post.golf_round.golf_holes
                                .filter((h: any) => h.hole_number <= 9)
                                .map((hole: any) => (
                                  <td key={hole.hole_number} className="text-center py-1 px-1 text-gray-600">
                                    {hole.distance_yards || '-'}
                                  </td>
                                ))}
                              <td className="text-center py-1 px-2 font-medium text-gray-700 bg-gray-100">
                                {post.golf_round.golf_holes
                                  .filter((h: any) => h.hole_number <= 9)
                                  .reduce((sum: number, h: any) => sum + (h.distance_yards || 0), 0) || '-'}
                              </td>
                            </tr>
                            {/* Par Row */}
                            <tr className="border-b border-gray-300 bg-yellow-50">
                              <td className="py-1 px-2 font-semibold text-gray-800">PAR</td>
                              {post.golf_round.golf_holes
                                .filter((h: any) => h.hole_number <= 9)
                                .map((hole: any) => (
                                  <td key={hole.hole_number} className="text-center py-1 px-1 font-semibold text-gray-800">
                                    {hole.par}
                                  </td>
                                ))}
                              <td className="text-center py-1 px-2 font-bold text-gray-800 bg-yellow-100">
                                {post.golf_round.golf_holes
                                  .filter((h: any) => h.hole_number <= 9)
                                  .reduce((sum: number, h: any) => sum + (h.par || 0), 0)}
                              </td>
                            </tr>
                            {/* Score Row */}
                            <tr className="border-b-2 border-gray-400">
                              <td className="py-1.5 px-2 font-bold text-gray-900">SCORE</td>
                              {post.golf_round.golf_holes
                                .filter((h: any) => h.hole_number <= 9)
                                .map((hole: any) => {
                                  const diff = hole.strokes - hole.par;
                                  let bgColor = 'bg-white';
                                  let textColor = 'text-gray-900';
                                  let border = '';

                                  if (diff === -2) { // Eagle
                                    border = 'ring-2 ring-blue-500 ring-inset';
                                    textColor = 'text-blue-600 font-black';
                                  } else if (diff === -1) { // Birdie
                                    border = 'ring-1 ring-blue-400 ring-inset';
                                    textColor = 'text-blue-600 font-bold';
                                  } else if (diff === 1) { // Bogey
                                    border = 'border border-red-400';
                                    textColor = 'text-red-600 font-semibold';
                                  } else if (diff >= 2) { // Double+
                                    border = 'ring-2 ring-red-500 ring-inset';
                                    textColor = 'text-red-600 font-bold';
                                  } else { // Par
                                    textColor = 'text-gray-900 font-semibold';
                                  }

                                  return (
                                    <td key={hole.hole_number} className="text-center py-1 px-1">
                                      <div className={`${bgColor} ${textColor} ${border} rounded mx-auto w-6 h-6 flex items-center justify-center`}>
                                        {hole.strokes}
                                      </div>
                                    </td>
                                  );
                                })}
                              <td className="text-center py-1.5 px-2 bg-blue-50">
                                <span className="font-bold text-blue-900 text-sm">
                                  {post.golf_round.golf_holes
                                    .filter((h: any) => h.hole_number <= 9)
                                    .reduce((sum: number, h: any) => sum + (h.strokes || 0), 0)}
                                </span>
                              </td>
                            </tr>
                            {/* Putts Row */}
                            <tr className="bg-gray-50">
                              <td className="py-1 px-2 text-[9px] text-gray-600">Putts</td>
                              {post.golf_round.golf_holes
                                .filter((h: any) => h.hole_number <= 9)
                                .map((hole: any) => (
                                  <td key={hole.hole_number} className="text-center py-1 px-1 text-gray-600">
                                    {hole.putts || '-'}
                                  </td>
                                ))}
                              <td className="text-center py-1 px-2 text-gray-700 bg-gray-100">
                                {post.golf_round.golf_holes
                                  .filter((h: any) => h.hole_number <= 9)
                                  .reduce((sum: number, h: any) => sum + (h.putts || 0), 0) || '-'}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Back 9 */}
                    {post.golf_round.golf_holes.filter((h: any) => h.hole_number > 9).length > 0 && (
                      <div>
                        <table className="w-full text-[10px]">
                          <thead>
                            <tr className="bg-green-100 border-b border-gray-300">
                              <th className="text-left py-1 px-2 font-semibold text-green-900">HOLE</th>
                              {post.golf_round.golf_holes
                                .filter((h: any) => h.hole_number > 9)
                                .map((hole: any) => (
                                  <th key={hole.hole_number} className="text-center py-1 px-1 font-bold text-green-900">
                                    {hole.hole_number}
                                  </th>
                                ))}
                              <th className="text-center py-1 px-2 font-bold text-green-900 bg-green-200">IN</th>
                            </tr>
                          </thead>
                          <tbody>
                            {/* Yardage */}
                            <tr className="border-b border-gray-200 bg-gray-50">
                              <td className="py-1 px-2 font-medium text-gray-700">YDS</td>
                              {post.golf_round.golf_holes
                                .filter((h: any) => h.hole_number > 9)
                                .map((hole: any) => (
                                  <td key={hole.hole_number} className="text-center py-1 px-1 text-gray-600">
                                    {hole.distance_yards || '-'}
                                  </td>
                                ))}
                              <td className="text-center py-1 px-2 font-medium text-gray-700 bg-gray-100">
                                {post.golf_round.golf_holes
                                  .filter((h: any) => h.hole_number > 9)
                                  .reduce((sum: number, h: any) => sum + (h.distance_yards || 0), 0) || '-'}
                              </td>
                            </tr>
                            {/* Par */}
                            <tr className="border-b border-gray-300 bg-yellow-50">
                              <td className="py-1 px-2 font-semibold text-gray-800">PAR</td>
                              {post.golf_round.golf_holes
                                .filter((h: any) => h.hole_number > 9)
                                .map((hole: any) => (
                                  <td key={hole.hole_number} className="text-center py-1 px-1 font-semibold text-gray-800">
                                    {hole.par}
                                  </td>
                                ))}
                              <td className="text-center py-1 px-2 font-bold text-gray-800 bg-yellow-100">
                                {post.golf_round.golf_holes
                                  .filter((h: any) => h.hole_number > 9)
                                  .reduce((sum: number, h: any) => sum + (h.par || 0), 0)}
                              </td>
                            </tr>
                            {/* Score */}
                            <tr className="border-b border-gray-300">
                              <td className="py-1.5 px-2 font-bold text-gray-900">SCORE</td>
                              {post.golf_round.golf_holes
                                .filter((h: any) => h.hole_number > 9)
                                .map((hole: any) => {
                                  const diff = hole.strokes - hole.par;
                                  let textColor = 'text-gray-900';
                                  let border = '';

                                  if (diff === -2) {
                                    border = 'ring-2 ring-blue-500 ring-inset';
                                    textColor = 'text-blue-600 font-black';
                                  } else if (diff === -1) {
                                    border = 'ring-1 ring-blue-400 ring-inset';
                                    textColor = 'text-blue-600 font-bold';
                                  } else if (diff === 1) {
                                    border = 'border border-red-400';
                                    textColor = 'text-red-600 font-semibold';
                                  } else if (diff >= 2) {
                                    border = 'ring-2 ring-red-500 ring-inset';
                                    textColor = 'text-red-600 font-bold';
                                  } else {
                                    textColor = 'text-gray-900 font-semibold';
                                  }

                                  return (
                                    <td key={hole.hole_number} className="text-center py-1 px-1">
                                      <div className={`bg-white ${textColor} ${border} rounded mx-auto w-6 h-6 flex items-center justify-center`}>
                                        {hole.strokes}
                                      </div>
                                    </td>
                                  );
                                })}
                              <td className="text-center py-1.5 px-2 bg-blue-50">
                                <span className="font-bold text-blue-900 text-sm">
                                  {post.golf_round.golf_holes
                                    .filter((h: any) => h.hole_number > 9)
                                    .reduce((sum: number, h: any) => sum + (h.strokes || 0), 0)}
                                </span>
                              </td>
                            </tr>
                            {/* Putts */}
                            <tr className="bg-gray-50">
                              <td className="py-1 px-2 text-[9px] text-gray-600">Putts</td>
                              {post.golf_round.golf_holes
                                .filter((h: any) => h.hole_number > 9)
                                .map((hole: any) => (
                                  <td key={hole.hole_number} className="text-center py-1 px-1 text-gray-600">
                                    {hole.putts || '-'}
                                  </td>
                                ))}
                              <td className="text-center py-1 px-2 text-gray-700 bg-gray-100">
                                {post.golf_round.golf_holes
                                  .filter((h: any) => h.hole_number > 9)
                                  .reduce((sum: number, h: any) => sum + (h.putts || 0), 0) || '-'}
                              </td>
                            </tr>
                          </tbody>
                        </table>

                        {/* Total Score Row */}
                        <div className="bg-blue-100 border-t-2 border-blue-300 px-2 py-1.5 flex justify-between items-center">
                          <span className="text-xs font-bold text-blue-900">TOTAL SCORE</span>
                          <span className="text-lg font-black text-blue-900">
                            {post.golf_round.gross_score}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Legend */}
                  <div className="mt-2 flex items-center gap-3 text-[9px] text-gray-600">
                    <div className="flex items-center gap-1">
                      <div className="w-4 h-4 rounded ring-2 ring-blue-500 ring-inset"></div>
                      <span>Eagle</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-4 h-4 rounded ring-1 ring-blue-400 ring-inset"></div>
                      <span>Birdie</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-4 h-4 rounded border border-red-400"></div>
                      <span>Bogey</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-4 h-4 rounded ring-2 ring-red-500 ring-inset"></div>
                      <span>Double+</span>
                    </div>
                  </div>
                </div>
              </details>
            )}
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