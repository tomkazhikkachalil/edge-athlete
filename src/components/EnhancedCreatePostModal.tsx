'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { getSportDefinition, getEnabledSports, type SportKey } from '@/lib/sports';
import { cssClasses } from '@/lib/design-tokens';
import { useToast } from '@/components/Toast';
import LazyImage from '@/components/LazyImage';
import GolfScorecardForm from '@/components/GolfScorecardForm';

interface CreatePostModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  onPostCreated?: (post: unknown) => void;
}

interface MediaFile {
  id: string;
  url: string;
  type: 'image' | 'video';
  size: number;
  file?: File;
  preview?: string;
}

// Post templates for quick start
const POST_TEMPLATES = {
  golf_round: {
    sportKey: 'golf',
    caption: '⛳ Just finished a great round! Shot {score} at {course}',
    placeholder: 'e.g., Shot 78 at Pebble Beach'
  },
  workout: {
    sportKey: 'general',
    caption: '💪 Crushed today\'s workout! #TrainHard #NeverSettle',
    placeholder: 'Share your workout highlights...'
  },
  game_day: {
    sportKey: 'general',
    caption: '🏆 Game day ready! Let\'s go team! #GameDay',
    placeholder: 'Share your game day excitement...'
  },
  achievement: {
    sportKey: 'general',
    caption: '🎯 New personal best! {achievement} #PersonalRecord',
    placeholder: 'e.g., New personal best! 5K in 18:30'
  }
};

// Popular hashtags by sport
const HASHTAG_SUGGESTIONS: Record<string, string[]> = {
  general: ['#Athletics', '#SportLife', '#Training', '#Fitness', '#Athlete'],
  golf: ['#Golf', '#GolfLife', '#GolfSwing', '#GolfCourse', '#Birdie', '#Eagle'],
  basketball: ['#Basketball', '#Hoops', '#NBA', '#BallIsLife', '#Dunk'],
  football: ['#Football', '#NFL', '#Touchdown', '#GameDay', '#Gridiron'],
  soccer: ['#Soccer', '#Football', '#Goal', '#FIFA', '#Beautiful Game']
};

export default function EnhancedCreatePostModal({ isOpen, onClose, userId, onPostCreated }: CreatePostModalProps) {
  const { showSuccess, showError } = useToast();
  const captionRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // State management
  const [selectedType, setSelectedType] = useState<string>('general');
  const [searchQuery, setSearchQuery] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // Media management with drag state
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [draggedOver, setDraggedOver] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  // Enhanced caption with hashtags
  const [caption, setCaption] = useState('');
  const [showHashtags, setShowHashtags] = useState(false);
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  // Golf scorecard data
  const [golfRoundData, setGolfRoundData] = useState<any>(null);

  // Character count
  const MAX_CAPTION_LENGTH = 500;
  const captionLength = caption.length;

  const enabledSports = getEnabledSports();

  const reset = () => {
    setSelectedType('general');
    setSearchQuery('');
    setDropdownOpen(false);
    setMediaFiles([]);
    setCaption('');
    setVisibility('public');
    setShowHashtags(false);
    setGolfRoundData(null);
    setShowPreview(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  // Enhanced file upload with preview
  const handleFileUpload = useCallback(async (files: FileList) => {
    if (files.length === 0) return;

    setUploading(true);

    try {
      const newFiles: MediaFile[] = [];

      for (const file of Array.from(files)) {
        // Validate file size (5MB limit)
        if (file.size > 5 * 1024 * 1024) {
          showError('File too large', `${file.name} exceeds 5MB limit`);
          continue;
        }

        // Create preview URL
        const preview = URL.createObjectURL(file);

        // Create media file object
        const mediaFile: MediaFile = {
          id: `${Date.now()}-${Math.random()}`,
          url: preview,
          type: file.type.startsWith('video') ? 'video' : 'image',
          size: file.size,
          file: file,
          preview: preview
        };

        newFiles.push(mediaFile);
      }

      setMediaFiles(prev => [...prev, ...newFiles].slice(0, 10)); // Max 10 files

    } catch (error) {
      showError('Upload failed', 'Please try again');
    } finally {
      setUploading(false);
    }
  }, [showError]);

  // Drag and drop handlers
  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex !== null && draggedIndex !== index) {
      const draggedFile = mediaFiles[draggedIndex];
      const newFiles = [...mediaFiles];
      newFiles.splice(draggedIndex, 1);
      newFiles.splice(index, 0, draggedFile);
      setMediaFiles(newFiles);
      setDraggedIndex(index);
    }
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  // Apply template
  const applyTemplate = (templateKey: keyof typeof POST_TEMPLATES) => {
    const template = POST_TEMPLATES[templateKey];
    setSelectedType(template.sportKey);
    setCaption(template.caption);
    captionRef.current?.focus();
  };

  // Add hashtag to caption
  const addHashtag = (hashtag: string) => {
    setCaption(prev => {
      const newCaption = prev.trim() + (prev ? ' ' : '') + hashtag;
      return newCaption.slice(0, MAX_CAPTION_LENGTH);
    });
    captionRef.current?.focus();
  };

  // Auto-suggest hashtags based on caption
  const suggestedHashtags = HASHTAG_SUGGESTIONS[selectedType] || HASHTAG_SUGGESTIONS.general;

  // Handle actual media upload to server
  const uploadMediaToServer = async (file: File): Promise<{ url: string }> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('userId', userId);

    const response = await fetch('/api/upload/post-media', {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      throw new Error('Upload failed');
    }

    return response.json();
  };

  // Handle post submission
  const handleSubmit = async () => {
    if (selectedType === 'general' && mediaFiles.length === 0) {
      showError('Media required', 'Please add at least one image or video');
      return;
    }

    if (selectedType === 'golf' && (!golfRoundData || !golfRoundData.courseName)) {
      showError('Golf round required', 'Please fill in the golf scorecard details');
      return;
    }

    setIsSubmitting(true);

    try {
      // Upload media files to server
      const uploadedMedia = await Promise.all(
        mediaFiles.map(async (file) => {
          if (file.file) {
            const { url } = await uploadMediaToServer(file.file);
            return { ...file, url };
          }
          return file;
        })
      );

      const payload = {
        userId,
        sportKey: selectedType,
        postType: selectedType === 'general' ? 'media' : 'mixed',
        caption,
        visibility,
        golfData: selectedType === 'golf' ? golfRoundData : undefined,
        mediaFiles: uploadedMedia.map((file, index) => ({
          url: file.url,
          type: file.type,
          sortOrder: index
        }))
      };

      const response = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error('Failed to create post');
      }

      const result = await response.json();
      showSuccess('Post created successfully! 🎉');

      if (onPostCreated) {
        onPostCreated(result.post);
      }

      handleClose();

    } catch (error) {
      showError('Failed to create post', 'Please try again');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Clean up preview URLs on unmount
  useEffect(() => {
    return () => {
      mediaFiles.forEach(file => {
        if (file.preview) {
          URL.revokeObjectURL(file.preview);
        }
      });
    };
  }, [mediaFiles]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-6">
      <div className="bg-white rounded-lg shadow-xl max-w-6xl w-full max-h-[95vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 bg-gradient-to-r from-blue-500 to-purple-600">
          <h2 className="text-2xl font-bold text-white">Create Post</h2>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-white/20 rounded-md transition-colors"
            aria-label="Close modal"
          >
            <i className="fas fa-times text-white text-lg"></i>
          </button>
        </div>

        {/* Quick Templates */}
        <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
          <div className="flex items-center gap-2 overflow-x-auto">
            <span className="text-sm font-medium text-gray-600 whitespace-nowrap">Quick Start:</span>
            {Object.entries(POST_TEMPLATES).map(([key, template]) => (
              <button
                key={key}
                onClick={() => applyTemplate(key as keyof typeof POST_TEMPLATES)}
                className="px-3 py-1 text-xs bg-white border border-gray-300 rounded-full hover:bg-blue-50 hover:border-blue-300 whitespace-nowrap transition-colors"
              >
                {key.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
              </button>
            ))}
          </div>
        </div>

        {/* Main Content Area - Scrollable */}
        <div className="flex-1 overflow-y-auto">
          {/* Single Column Content */}
          <div className="p-6">
            {/* Sport Selection */}
            <div className="mb-6">
              <label className="text-sm font-semibold text-gray-700 block mb-2">
                Sport Category
              </label>
              <select
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="general">General / Media Only</option>
                {enabledSports.map(sport => (
                  <option key={sport.sportKey} value={sport.sportKey}>
                    {getSportDefinition(sport.sportKey).display_name}
                  </option>
                ))}
              </select>
            </div>

            {/* Golf Scorecard Section */}
            {selectedType === 'golf' && (
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Golf Scorecard</h3>
                <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
                  <GolfScorecardForm
                    onDataChange={(data) => setGolfRoundData(data)}
                    initialData={golfRoundData}
                  />
                </div>
              </div>
            )}

            {/* Media Upload Section */}
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Media</h3>

              {/* Compact Upload Button */}
              <div className="flex items-center gap-3 mb-4">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className={`flex items-center gap-2 px-3 py-2 text-sm border-2 border-dashed rounded-lg transition-all ${
                    draggedOver
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50 text-gray-600'
                  }`}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDraggedOver(false);
                    if (e.dataTransfer.files) {
                      handleFileUpload(e.dataTransfer.files);
                    }
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDraggedOver(true);
                  }}
                  onDragLeave={() => setDraggedOver(false)}
                >
                  <i className={`fas fa-plus text-sm ${
                    draggedOver ? 'text-blue-500' : 'text-gray-500'
                  }`}></i>
                  Add Media
                </button>

                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/*,video/*"
                  className="hidden"
                  onChange={(e) => e.target.files && handleFileUpload(e.target.files)}
                />

                <span className="text-xs text-gray-500">
                  JPG, PNG, GIF, MP4 (Max 5MB each)
                </span>
              </div>

              {/* Large Media Display */}
              {mediaFiles.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700">
                      {mediaFiles.length} file{mediaFiles.length !== 1 ? 's' : ''} selected
                    </span>
                    <button
                      onClick={() => setMediaFiles([])}
                      className="text-sm text-red-600 hover:text-red-700 font-medium"
                    >
                      Clear all
                    </button>
                  </div>

                  {/* Primary Media Display - Larger */}
                  {mediaFiles.length > 0 && (
                    <div className="relative rounded-lg overflow-hidden">
                      <div className="aspect-[4/3] relative">
                        {mediaFiles[0].type === 'image' ? (
                          <LazyImage
                            src={mediaFiles[0].url}
                            alt=""
                            className="w-full h-full object-cover"
                            width={600}
                            height={450}
                          />
                        ) : (
                          <video src={mediaFiles[0].url} className="w-full h-full object-cover" controls />
                        )}

                        {/* Primary media controls */}
                        <div className="absolute top-2 left-2 bg-black/60 text-white text-xs px-2 py-1 rounded">
                          Primary
                        </div>
                        <button
                          onClick={() => setMediaFiles(prev => prev.filter((_, i) => i !== 0))}
                          className="absolute top-2 right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center hover:bg-red-600 transition-colors"
                        >
                          <i className="fas fa-times text-xs"></i>
                        </button>

                        {/* Multiple files indicator */}
                        {mediaFiles.length > 1 && (
                          <div className="absolute bottom-2 right-2 bg-black/70 text-white text-xs px-2 py-1 rounded">
                            +{mediaFiles.length - 1} more
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Secondary Media Grid - Smaller thumbnails */}
                  {mediaFiles.length > 1 && (
                    <div className="grid grid-cols-4 gap-2">
                      {mediaFiles.slice(1).map((file, index) => (
                        <div
                          key={file.id}
                          draggable
                          onDragStart={() => handleDragStart(index + 1)}
                          onDragOver={(e) => handleDragOver(e, index + 1)}
                          onDragEnd={handleDragEnd}
                          className={`relative aspect-square bg-gray-100 rounded-lg overflow-hidden cursor-move ${
                            draggedIndex === index + 1 ? 'opacity-50' : ''
                          } hover:ring-2 hover:ring-blue-300 transition-all`}
                        >
                          {/* Order badge */}
                          <div className="absolute top-1 left-1 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded">
                            {index + 2}
                          </div>

                          {file.type === 'image' ? (
                            <LazyImage
                              src={file.url}
                              alt=""
                              className="w-full h-full object-cover"
                              width={150}
                              height={150}
                            />
                          ) : (
                            <video src={file.url} className="w-full h-full object-cover" />
                          )}

                          <button
                            onClick={() => setMediaFiles(prev => prev.filter(f => f.id !== file.id))}
                            className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs hover:bg-red-600"
                          >
                            <i className="fas fa-times"></i>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <p className="text-xs text-gray-500 flex items-center gap-1 mt-1">
                    <i className="fas fa-info-circle"></i>
                    Primary image shows first in post. Drag thumbnails to reorder.
                  </p>
                </div>
              )}

              {uploading && (
                <div className="mt-4 flex items-center text-blue-600">
                  <i className="fas fa-spinner fa-spin mr-2"></i>
                  <span className="text-sm">Processing media...</span>
                </div>
              )}
            </div>

            {/* Caption and Settings */}
            <div className="space-y-6">
              {/* Enhanced Caption with Character Count */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold text-gray-700">
                    Caption
                  </label>
                  <span className={`text-xs ${
                    captionLength > MAX_CAPTION_LENGTH * 0.9 ? 'text-red-600' : 'text-gray-500'
                  }`}>
                    {captionLength}/{MAX_CAPTION_LENGTH}
                  </span>
                </div>

                <textarea
                  ref={captionRef}
                  value={caption}
                  onChange={(e) => setCaption(e.target.value.slice(0, MAX_CAPTION_LENGTH))}
                  placeholder="Share your thoughts..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                  rows={4}
                />

                {/* Hashtag Suggestions */}
                <div className="mt-2">
                  <button
                    onClick={() => setShowHashtags(!showHashtags)}
                    className="text-sm text-blue-600 hover:text-blue-700"
                  >
                    <i className="fas fa-hashtag mr-1"></i>
                    {showHashtags ? 'Hide' : 'Show'} hashtag suggestions
                  </button>

                  {showHashtags && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {suggestedHashtags.map(tag => (
                        <button
                          key={tag}
                          onClick={() => addHashtag(tag)}
                          className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded-full hover:bg-blue-100 hover:text-blue-700 transition-colors"
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Visibility Settings */}
              <div>
                <label className="text-sm font-semibold text-gray-700 block mb-2">
                  Visibility
                </label>
                <div className="flex gap-4">
                  <label className="flex items-center cursor-pointer">
                    <input
                      type="radio"
                      value="public"
                      checked={visibility === 'public'}
                      onChange={(e) => setVisibility(e.target.value as 'public' | 'private')}
                      className="mr-2"
                    />
                    <span className="text-sm">
                      <i className="fas fa-globe mr-1 text-gray-500"></i>
                      Public
                    </span>
                  </label>
                  <label className="flex items-center cursor-pointer">
                    <input
                      type="radio"
                      value="private"
                      checked={visibility === 'private'}
                      onChange={(e) => setVisibility(e.target.value as 'public' | 'private')}
                      className="mr-2"
                    />
                    <span className="text-sm">
                      <i className="fas fa-lock mr-1 text-gray-500"></i>
                      Private
                    </span>
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between p-6 border-t border-gray-200 bg-gray-50">
          <div className="text-sm text-gray-600">
            {selectedType === 'general' && mediaFiles.length === 0 && (
              <span className="text-red-600">
                <i className="fas fa-exclamation-circle mr-1"></i>
                Media required for this post type
              </span>
            )}
            {selectedType === 'golf' && (!golfRoundData || !golfRoundData.courseName) && (
              <span className="text-red-600">
                <i className="fas fa-exclamation-circle mr-1"></i>
                Please fill in golf scorecard details above
              </span>
            )}
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleClose}
              className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => setShowPreview(true)}
              disabled={
                (selectedType === 'general' && mediaFiles.length === 0) ||
                (selectedType === 'golf' && (!golfRoundData || !golfRoundData.courseName))
              }
              className={`px-4 py-2 font-medium rounded-lg transition-colors ${
                (selectedType === 'general' && mediaFiles.length === 0) ||
                (selectedType === 'golf' && (!golfRoundData || !golfRoundData.courseName))
                  ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300'
              }`}
            >
              <i className="fas fa-eye mr-2"></i>
              Preview
            </button>
            <button
              onClick={handleSubmit}
              disabled={isSubmitting ||
                        (selectedType === 'general' && mediaFiles.length === 0) ||
                        (selectedType === 'golf' && (!golfRoundData || !golfRoundData.courseName))}
              className={`px-6 py-2 text-white rounded-lg font-medium transition-all ${
                isSubmitting ||
                (selectedType === 'general' && mediaFiles.length === 0) ||
                (selectedType === 'golf' && (!golfRoundData || !golfRoundData.courseName))
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700'
              }`}
            >
              {isSubmitting ? (
                <>
                  <i className="fas fa-spinner fa-spin mr-2"></i>
                  Creating...
                </>
              ) : (
                <>
                  <i className="fas fa-paper-plane mr-2"></i>
                  Create Post
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Preview Modal */}
      {showPreview && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-lg shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto m-4">
            {/* Preview Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gray-50">
              <h3 className="text-lg font-semibold text-gray-800">Post Preview</h3>
              <button
                onClick={() => setShowPreview(false)}
                className="p-2 hover:bg-gray-200 rounded-md transition-colors"
              >
                <i className="fas fa-times text-gray-600"></i>
              </button>
            </div>

            {/* Preview Content - Mock Post Layout */}
            <div className="p-6">
              <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
                {/* Mock User Header */}
                <div className="p-4 border-b border-gray-100">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
                      <i className="fas fa-user text-white text-sm"></i>
                    </div>
                    <div>
                      <div className="font-semibold text-gray-900">Your Name</div>
                      <div className="text-sm text-gray-500 flex items-center gap-2">
                        <span>Just now</span>
                        <i className={`fas ${visibility === 'public' ? 'fa-globe' : 'fa-lock'} text-xs`}></i>
                        <span className="capitalize">{visibility}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Post Content */}
                <div className="p-4">
                  {/* Caption */}
                  {caption && (
                    <div className="mb-4">
                      <p className="text-gray-900 whitespace-pre-wrap leading-relaxed">
                        {caption}
                      </p>
                    </div>
                  )}

                  {/* Media Display */}
                  {mediaFiles.length > 0 && (
                    <div className="mb-4">
                      {mediaFiles.length === 1 ? (
                        <div className="rounded-lg overflow-hidden bg-gray-100">
                          {mediaFiles[0].type === 'image' ? (
                            <LazyImage
                              src={mediaFiles[0].url}
                              alt="Post media"
                              className="w-full h-auto max-h-96 object-cover"
                              width={600}
                              height={400}
                            />
                          ) : (
                            <video
                              src={mediaFiles[0].url}
                              className="w-full h-auto max-h-96 object-cover"
                              controls
                            />
                          )}
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-1 rounded-lg overflow-hidden">
                          {mediaFiles.slice(0, 4).map((file, index) => (
                            <div key={file.id} className="relative aspect-square bg-gray-100">
                              {file.type === 'image' ? (
                                <LazyImage
                                  src={file.url}
                                  alt=""
                                  className="w-full h-full object-cover"
                                  width={300}
                                  height={300}
                                />
                              ) : (
                                <video src={file.url} className="w-full h-full object-cover" />
                              )}
                              {index === 3 && mediaFiles.length > 4 && (
                                <div className="absolute inset-0 bg-black bg-opacity-60 flex items-center justify-center">
                                  <span className="text-white text-xl font-bold">
                                    +{mediaFiles.length - 4}
                                  </span>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Golf Scorecard Preview */}
                  {selectedType === 'golf' && golfRoundData && (
                    <div className="mb-4 p-4 bg-green-50 rounded-lg border border-green-200">
                      <div className="flex items-center gap-2 mb-2">
                        <i className="fas fa-golf-ball text-green-600"></i>
                        <span className="font-semibold text-green-800">Golf Round</span>
                      </div>
                      <div className="text-sm text-green-700">
                        <div><strong>Course:</strong> {golfRoundData.courseName}</div>
                        {golfRoundData.score && <div><strong>Score:</strong> {golfRoundData.score}</div>}
                        {golfRoundData.par && <div><strong>Par:</strong> {golfRoundData.par}</div>}
                      </div>
                    </div>
                  )}

                  {/* Sport Badge */}
                  {selectedType !== 'general' && (
                    <div className="mb-4">
                      <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">
                        <i className="fas fa-tag"></i>
                        {getSportDefinition(selectedType as SportKey).display_name}
                      </span>
                    </div>
                  )}
                </div>

                {/* Mock Engagement Footer */}
                <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between text-gray-500">
                  <div className="flex items-center gap-4">
                    <button className="flex items-center gap-1 hover:text-blue-600 transition-colors">
                      <i className="far fa-heart"></i>
                      <span className="text-sm">Like</span>
                    </button>
                    <button className="flex items-center gap-1 hover:text-blue-600 transition-colors">
                      <i className="far fa-comment"></i>
                      <span className="text-sm">Comment</span>
                    </button>
                    <button className="flex items-center gap-1 hover:text-blue-600 transition-colors">
                      <i className="fas fa-share"></i>
                      <span className="text-sm">Share</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Preview Footer */}
            <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-between">
              <button
                onClick={() => setShowPreview(false)}
                className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
              >
                Edit Post
              </button>
              <button
                onClick={() => {
                  setShowPreview(false);
                  handleSubmit();
                }}
                disabled={isSubmitting}
                className="px-6 py-2 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg hover:from-blue-700 hover:to-purple-700 transition-all font-medium"
              >
                {isSubmitting ? (
                  <>
                    <i className="fas fa-spinner fa-spin mr-2"></i>
                    Creating...
                  </>
                ) : (
                  <>
                    <i className="fas fa-paper-plane mr-2"></i>
                    Post Now
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}