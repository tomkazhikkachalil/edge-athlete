'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useToast } from '@/components/Toast';
import LazyImage from '@/components/LazyImage';
import GolfScorecardForm from '@/components/GolfScorecardForm';
import TagPeopleModal from '@/components/TagPeopleModal';
import SportSelector from '@/components/SportSelector';
import { getSportDefinition, type SportKey } from '@/lib/sports/SportRegistry';

interface CreatePostModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  onPostCreated?: (post: unknown) => void;
  defaultSportKey?: SportKey | 'general'; // Optional: pre-select a sport
}

interface MediaFile {
  id: string;
  url: string;
  type: 'image' | 'video';
  size: number;
  file?: File;
  preview?: string;
}

// No longer needed - using SportSelector instead

// Popular hashtags suggestions
const HASHTAG_SUGGESTIONS = {
  general: ['#Athletics', '#SportLife', '#Training', '#Fitness', '#Athlete', '#PersonalBest', '#GameDay', '#Champions'],
  golf: ['#Golf', '#GolfLife', '#GolfSwing', '#GolfCourse', '#Birdie', '#Eagle', '#Par', '#HoleInOne', '#PGA', '#18Holes']
};

// Tags for categorization
const TAG_OPTIONS = {
  general: [
    { value: 'training', label: 'Training', color: 'blue' },
    { value: 'competition', label: 'Competition', color: 'red' },
    { value: 'achievement', label: 'Achievement', color: 'green' },
    { value: 'team', label: 'Team', color: 'purple' },
    { value: 'lifestyle', label: 'Lifestyle', color: 'yellow' }
  ],
  golf: [
    { value: 'tournament', label: 'Tournament', color: 'red' },
    { value: 'practice', label: 'Practice Round', color: 'blue' },
    { value: 'casual', label: 'Casual Round', color: 'green' },
    { value: 'lesson', label: 'Lesson', color: 'purple' },
    { value: 'achievement', label: 'Personal Best', color: 'yellow' }
  ]
};

export default function CreatePostModal({
  isOpen,
  onClose,
  userId,
  onPostCreated,
  defaultSportKey = 'general'
}: CreatePostModalProps) {
  const { showSuccess, showError } = useToast();
  const captionRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Post type and content
  const [postType, setPostType] = useState<SportKey | 'general'>(defaultSportKey);
  const [showSportSelector, setShowSportSelector] = useState(false);
  const [caption, setCaption] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [showHashtagSuggestions, setShowHashtagSuggestions] = useState(false);
  const [customHashtag, setCustomHashtag] = useState('');

  // Media management
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [draggedOver, setDraggedOver] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  // Golf specific data
  const [golfRoundData, setGolfRoundData] = useState<any>(null);

  // Visibility and submission
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  // Tagging people
  const [taggedProfiles, setTaggedProfiles] = useState<string[]>([]);
  const [taggedProfilesData, setTaggedProfilesData] = useState<{id: string; name: string}[]>([]);
  const [showTagModal, setShowTagModal] = useState(false);

  // Character limits
  const MAX_CAPTION_LENGTH = 500;
  const MAX_HASHTAGS = 10;
  const MAX_MEDIA_FILES = 10;

  // Reset form
  const reset = () => {
    setPostType('general' as SportKey | 'general');
    setCaption('');
    setSelectedTags([]);
    setHashtags([]);
    setMediaFiles([]);
    setGolfRoundData(null);
    setVisibility('public');
    setShowHashtagSuggestions(false);
    setCustomHashtag('');
    setShowPreview(false);
    setTaggedProfiles([]);
    setTaggedProfilesData([]);
    setShowTagModal(false);
  };

  // Handle close
  const handleClose = () => {
    reset();
    onClose();
  };

  // Handle file upload
  const handleFileUpload = useCallback(async (files: FileList) => {
    if (files.length === 0) return;
    if (mediaFiles.length + files.length > MAX_MEDIA_FILES) {
      showError('Too many files', `Maximum ${MAX_MEDIA_FILES} files allowed`);
      return;
    }

    setUploading(true);
    const newFiles: MediaFile[] = [];

    for (const file of Array.from(files)) {
      // Validate file
      if (file.size > 5 * 1024 * 1024) {
        showError('File too large', `${file.name} exceeds 5MB limit`);
        continue;
      }

      const isImage = file.type.startsWith('image/');
      const isVideo = file.type.startsWith('video/');

      if (!isImage && !isVideo) {
        showError('Invalid file type', `${file.name} is not an image or video`);
        continue;
      }

      // Create preview
      const preview = URL.createObjectURL(file);

      newFiles.push({
        id: `${Date.now()}-${Math.random()}`,
        url: preview,
        type: isVideo ? 'video' : 'image',
        size: file.size,
        file: file,
        preview: preview
      });
    }

    setMediaFiles(prev => [...prev, ...newFiles]);
    setUploading(false);
  }, [mediaFiles.length, showError]);

  // Media drag and drop handlers
  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex !== null && draggedIndex !== index) {
      const newFiles = [...mediaFiles];
      const draggedFile = newFiles[draggedIndex];
      newFiles.splice(draggedIndex, 1);
      newFiles.splice(index, 0, draggedFile);
      setMediaFiles(newFiles);
      setDraggedIndex(index);
    }
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  // Remove media file
  const removeMediaFile = (fileId: string) => {
    const file = mediaFiles.find(f => f.id === fileId);
    if (file?.preview) {
      URL.revokeObjectURL(file.preview);
    }
    setMediaFiles(prev => prev.filter(f => f.id !== fileId));
  };

  // Toggle tag selection
  const toggleTag = (tagValue: string) => {
    setSelectedTags(prev =>
      prev.includes(tagValue)
        ? prev.filter(t => t !== tagValue)
        : [...prev, tagValue]
    );
  };

  // Add hashtag
  const addHashtag = (hashtag: string) => {
    const formattedHashtag = hashtag.startsWith('#') ? hashtag : `#${hashtag}`;
    if (hashtags.length < MAX_HASHTAGS && !hashtags.includes(formattedHashtag)) {
      setHashtags(prev => [...prev, formattedHashtag]);
    }
  };

  // Remove hashtag
  const removeHashtag = (hashtag: string) => {
    setHashtags(prev => prev.filter(h => h !== hashtag));
  };

  // Handle tag people selection
  const handleTagPeopleComplete = (selectedIds: string[], selectedProfiles?: any[]) => {
    setTaggedProfiles(selectedIds);

    // Use the profile data passed from the modal
    if (selectedProfiles && selectedProfiles.length > 0) {
      const profilesData = selectedProfiles.map(profile => {
        const name = profile.first_name && profile.last_name
          ? `${profile.first_name} ${profile.last_name}`
          : profile.full_name || 'Unknown User';
        return { id: profile.id, name };
      });
      setTaggedProfilesData(profilesData);
    }
  };

  // Remove tagged person
  const removeTaggedPerson = (profileId: string) => {
    setTaggedProfiles(prev => prev.filter(id => id !== profileId));
    setTaggedProfilesData(prev => prev.filter(p => p.id !== profileId));
  };

  // Handle custom hashtag input
  const handleCustomHashtagSubmit = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && customHashtag.trim()) {
      e.preventDefault();
      addHashtag(customHashtag.trim());
      setCustomHashtag('');
    }
  };

  // Generate golf caption from stats
  const generateGolfCaption = () => {
    if (!golfRoundData || postType !== 'golf') return '';

    const { holesData, courseName } = golfRoundData;
    const scoredHoles = holesData?.filter((h: any) => h.score !== undefined) || [];

    if (scoredHoles.length === 0) return '';

    const totalScore = scoredHoles.reduce((sum: number, h: any) => sum + (h.score || 0), 0);
    const totalPar = scoredHoles.reduce((sum: number, h: any) => sum + h.par, 0);
    const differential = totalScore - totalPar;

    let caption = `Shot ${totalScore}`;
    if (differential === 0) caption += ' (Even)';
    else if (differential > 0) caption += ` (+${differential})`;
    else caption += ` (${differential})`;

    if (courseName) caption += ` at ${courseName}`;

    // Add some stats if available
    const putts = scoredHoles.reduce((sum: number, h: any) => sum + (h.putts || 0), 0);
    if (putts > 0) caption += ` | ${putts} putts`;

    const birdies = scoredHoles.filter((h: any) => h.score === h.par - 1).length;
    if (birdies > 0) caption += ` | ${birdies} ${birdies === 1 ? 'birdie' : 'birdies'}`;

    return caption;
  };

  // Upload media to server
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

  // Validation
  const isValidForSubmission = () => {
    // General posts need either caption or media
    if (postType === 'general') {
      return caption.trim().length > 0 || mediaFiles.length > 0;
    }

    // Golf posts need scorecard data
    if (postType === 'golf') {
      return golfRoundData && golfRoundData.courseName && golfRoundData.holesData?.some((h: any) => h.score !== undefined);
    }

    return false;
  };

  // Submit post
  const handleSubmit = async () => {
    if (!isValidForSubmission()) {
      showError('Incomplete post', 'Please add content to your post');
      return;
    }

    setIsSubmitting(true);

    try {
      console.log('Starting post submission...');

      // Upload media files
      console.log('Uploading media files:', mediaFiles.length);
      const uploadedMedia = await Promise.all(
        mediaFiles.map(async (file) => {
          if (file.file) {
            console.log('Uploading file:', file.file.name);
            const { url } = await uploadMediaToServer(file.file);
            console.log('File uploaded:', url);
            return { ...file, url };
          }
          return file;
        })
      );

      // Prepare post data (userId comes from auth)
      const postData = {
        postType,
        caption: caption.trim(),
        tags: selectedTags,
        hashtags,
        visibility,
        media: uploadedMedia.map((file, index) => ({
          url: file.url,
          type: file.type,
          sortOrder: index
        })),
        golfData: postType === 'golf' ? golfRoundData : undefined,
        taggedProfiles: taggedProfiles // Add tagged people
      };

      console.log('Creating post with data:', postData);

      // Create post
      const response = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // Important: include cookies for authentication
        body: JSON.stringify(postData)
      });

      console.log('Post response status:', response.status);

      if (!response.ok) {
        const errorData = await response.json();
        console.error('Post creation failed:', errorData);
        throw new Error(errorData.error || 'Failed to create post');
      }

      const result = await response.json();
      console.log('Post created successfully:', result);

      showSuccess('Post created successfully! 🎉');

      // Call callback to refresh posts
      if (onPostCreated) {
        onPostCreated(result.post);
      }

      // Close modal
      handleClose();
    } catch (error) {
      console.error('Post submission error:', error);
      showError('Failed to create post', error instanceof Error ? error.message : 'Please try again');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Clean up previews on unmount
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

  const currentTags = TAG_OPTIONS[postType as keyof typeof TAG_OPTIONS] || TAG_OPTIONS.general;
  const currentHashtags = HASHTAG_SUGGESTIONS[postType as keyof typeof HASHTAG_SUGGESTIONS] || HASHTAG_SUGGESTIONS.general;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-2xl font-bold text-gray-900">Create Post</h2>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="Close modal"
          >
            <i className="fas fa-times text-gray-500 text-lg"></i>
          </button>
        </div>

        {/* Content - Scrollable */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Sport/Post Type Selection */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-700 mb-3">Post Type</label>
            <button
              onClick={() => setShowSportSelector(true)}
              className="w-full p-4 border-2 border-gray-300 rounded-lg text-left hover:border-blue-500 hover:bg-blue-50 transition-all group"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-lg bg-gray-100 group-hover:bg-blue-100 flex items-center justify-center transition-colors">
                    <i className={`${
                      postType === 'general'
                        ? 'fas fa-edit'
                        : getSportDefinition(postType as SportKey).icon_id
                    } text-xl ${
                      postType === 'general' ? 'text-gray-500' : 'text-blue-600'
                    } group-hover:text-blue-600`}></i>
                  </div>
                  <div>
                    <div className="font-semibold text-gray-900">
                      {postType === 'general'
                        ? 'General Post'
                        : getSportDefinition(postType as SportKey).display_name
                      }
                    </div>
                    <div className="text-sm text-gray-500">
                      {postType === 'general'
                        ? 'Text, photos, and hashtags'
                        : getSportDefinition(postType as SportKey).primary_action
                      }
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-blue-600">
                  <span className="text-sm font-medium">Change</span>
                  <i className="fas fa-chevron-right"></i>
                </div>
              </div>
            </button>
          </div>

          {/* Golf Scorecard (when golf is selected) */}
          {postType === 'golf' && (
            <div className="mb-6">
              <div className="bg-green-50 rounded-lg border border-green-200 p-4">
                <GolfScorecardForm
                  onDataChange={(data) => setGolfRoundData(data)}
                  initialData={golfRoundData}
                />
              </div>

              {/* Generate Caption from Stats */}
              {golfRoundData && (
                <button
                  onClick={() => setCaption(generateGolfCaption())}
                  className="mt-3 text-sm text-green-600 hover:text-green-700 font-medium"
                >
                  <i className="fas fa-magic mr-1"></i>
                  Generate caption from scorecard
                </button>
              )}
            </div>
          )}

          {/* Caption */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-semibold text-gray-700">
                Caption
              </label>
              <span className={`text-xs ${
                caption.length > MAX_CAPTION_LENGTH * 0.9 ? 'text-red-600' : 'text-gray-500'
              }`}>
                {caption.length}/{MAX_CAPTION_LENGTH}
              </span>
            </div>
            <textarea
              ref={captionRef}
              value={caption}
              onChange={(e) => setCaption(e.target.value.slice(0, MAX_CAPTION_LENGTH))}
              placeholder="Share your thoughts..."
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
              rows={4}
            />
          </div>

          {/* Tags */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-700 mb-3">Tags</label>
            <div className="flex flex-wrap gap-2">
              {currentTags.map(tag => (
                <button
                  key={tag.value}
                  onClick={() => toggleTag(tag.value)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                    selectedTags.includes(tag.value)
                      ? `bg-${tag.color}-100 text-${tag.color}-800 border-2 border-${tag.color}-300`
                      : 'bg-gray-100 text-gray-600 border-2 border-gray-200 hover:bg-gray-200'
                  }`}
                >
                  {selectedTags.includes(tag.value) && (
                    <i className="fas fa-check mr-1 text-xs"></i>
                  )}
                  {tag.label}
                </button>
              ))}
            </div>
          </div>

          {/* Hashtags */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm font-semibold text-gray-700">
                Hashtags ({hashtags.length}/{MAX_HASHTAGS})
              </label>
              <button
                onClick={() => setShowHashtagSuggestions(!showHashtagSuggestions)}
                className="text-sm text-blue-600 hover:text-blue-700"
              >
                {showHashtagSuggestions ? 'Hide' : 'Show'} suggestions
              </button>
            </div>

            {/* Selected hashtags */}
            {hashtags.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {hashtags.map(hashtag => (
                  <span
                    key={hashtag}
                    className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm"
                  >
                    {hashtag}
                    <button
                      onClick={() => removeHashtag(hashtag)}
                      className="ml-1 hover:text-blue-900"
                    >
                      <i className="fas fa-times text-xs"></i>
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Custom hashtag input */}
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                value={customHashtag}
                onChange={(e) => setCustomHashtag(e.target.value)}
                onKeyDown={handleCustomHashtagSubmit}
                placeholder="Type a hashtag and press Enter"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                disabled={hashtags.length >= MAX_HASHTAGS}
              />
              <button
                onClick={() => {
                  if (customHashtag.trim()) {
                    addHashtag(customHashtag.trim());
                    setCustomHashtag('');
                  }
                }}
                disabled={!customHashtag.trim() || hashtags.length >= MAX_HASHTAGS}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
              >
                Add
              </button>
            </div>

            {/* Hashtag suggestions */}
            {showHashtagSuggestions && (
              <div className="flex flex-wrap gap-1">
                {currentHashtags
                  .filter(tag => !hashtags.includes(tag))
                  .map(hashtag => (
                    <button
                      key={hashtag}
                      onClick={() => addHashtag(hashtag)}
                      disabled={hashtags.length >= MAX_HASHTAGS}
                      className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded-full hover:bg-blue-100 hover:text-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {hashtag}
                    </button>
                  ))
                }
              </div>
            )}
          </div>

          {/* Tag People */}
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm font-semibold text-gray-700">Tag People</label>
              <button
                onClick={() => setShowTagModal(true)}
                className="flex items-center gap-2 px-3 py-1.5 text-sm text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors"
              >
                <i className="fas fa-user-tag"></i>
                {taggedProfiles.length > 0 ? `Tagged (${taggedProfiles.length})` : 'Add Tags'}
              </button>
            </div>

            {/* Tagged people chips */}
            {taggedProfilesData.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {taggedProfilesData.map(profile => (
                  <span
                    key={profile.id}
                    className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-100 text-blue-800 rounded-full text-sm font-medium border border-blue-300"
                  >
                    <i className="fas fa-user text-xs"></i>
                    {profile.name}
                    <button
                      onClick={() => removeTaggedPerson(profile.id)}
                      className="ml-1 hover:text-blue-900"
                    >
                      <i className="fas fa-times text-xs"></i>
                    </button>
                  </span>
                ))}
              </div>
            )}

            {taggedProfilesData.length === 0 && (
              <p className="text-sm text-gray-500">
                <i className="fas fa-info-circle mr-1"></i>
                Tag people who are in your photos or videos
              </p>
            )}
          </div>

          {/* Media Upload */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-700 mb-3">
              Media ({mediaFiles.length}/{MAX_MEDIA_FILES})
            </label>

            {/* Upload area */}
            <div
              className={`border-2 border-dashed rounded-lg p-6 text-center transition-all ${
                draggedOver
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-300 hover:border-gray-400'
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
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,video/*"
                className="hidden"
                onChange={(e) => e.target.files && handleFileUpload(e.target.files)}
              />

              <i className="fas fa-cloud-upload-alt text-4xl text-gray-400 mb-3"></i>
              <p className="text-gray-600 mb-2">
                Drag and drop files here, or{' '}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="text-blue-600 hover:text-blue-700 font-medium"
                >
                  browse
                </button>
              </p>
              <p className="text-xs text-gray-500">
                Images and videos up to 5MB each
              </p>
            </div>

            {/* Media preview grid */}
            {mediaFiles.length > 0 && (
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {mediaFiles.map((file, index) => (
                  <div
                    key={file.id}
                    draggable
                    onDragStart={() => handleDragStart(index)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDragEnd={handleDragEnd}
                    className={`relative aspect-square bg-gray-100 rounded-lg overflow-hidden cursor-move ${
                      draggedIndex === index ? 'opacity-50' : ''
                    }`}
                  >
                    {/* Media number badge */}
                    <div className="absolute top-2 left-2 bg-black bg-opacity-60 text-white text-xs px-2 py-1 rounded">
                      {index + 1}
                    </div>

                    {/* Media content */}
                    {file.type === 'image' ? (
                      <LazyImage
                        src={file.url}
                        alt=""
                        className="w-full h-full object-cover"
                        width={200}
                        height={200}
                      />
                    ) : (
                      <video src={file.url} className="w-full h-full object-cover" />
                    )}

                    {/* Remove button */}
                    <button
                      onClick={() => removeMediaFile(file.id)}
                      className="absolute top-2 right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center hover:bg-red-600 transition-colors"
                    >
                      <i className="fas fa-times text-xs"></i>
                    </button>
                  </div>
                ))}
              </div>
            )}

            {uploading && (
              <div className="mt-3 text-center text-blue-600">
                <i className="fas fa-spinner fa-spin mr-2"></i>
                Processing media...
              </div>
            )}
          </div>

          {/* Visibility */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-700 mb-3">Visibility</label>
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

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-gray-200 bg-gray-50">
          <div className="text-sm text-gray-600">
            {!isValidForSubmission() && (
              <span className="text-red-600">
                <i className="fas fa-exclamation-circle mr-1"></i>
                {postType === 'golf'
                  ? 'Please complete the scorecard'
                  : 'Add caption or media to post'
                }
              </span>
            )}
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleClose}
              className="px-6 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>

            <button
              onClick={() => setShowPreview(true)}
              disabled={!isValidForSubmission()}
              className="px-6 py-2 text-gray-700 bg-gray-100 border border-gray-300 rounded-lg hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <i className="fas fa-eye mr-2"></i>
              Preview
            </button>

            <button
              onClick={() => {
                console.log('Create Post button clicked');
                console.log('Is valid:', isValidForSubmission());
                console.log('Is submitting:', isSubmitting);
                handleSubmit();
              }}
              disabled={!isValidForSubmission() || isSubmitting}
              className="px-6 py-2 text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
        <PostPreview
          postType={postType}
          caption={caption}
          tags={selectedTags}
          hashtags={hashtags}
          mediaFiles={mediaFiles}
          visibility={visibility}
          golfData={golfRoundData}
          taggedPeople={taggedProfilesData}
          onClose={() => setShowPreview(false)}
          onPost={() => {
            setShowPreview(false);
            handleSubmit();
          }}
        />
      )}

      {/* Tag People Modal */}
      <TagPeopleModal
        isOpen={showTagModal}
        onClose={() => setShowTagModal(false)}
        existingTags={taggedProfiles}
        onSelectionComplete={handleTagPeopleComplete}
        selectionMode={true}
      />

      {/* Sport Selector Modal */}
      {showSportSelector && (
        <SportSelector
          selectedSport={postType}
          onSelectSport={(sport) => setPostType(sport)}
          onClose={() => setShowSportSelector(false)}
        />
      )}
    </div>
  );
}

// Post Preview Component
function PostPreview({
  postType,
  caption,
  tags,
  hashtags,
  mediaFiles,
  visibility,
  golfData,
  taggedPeople = [],
  onClose,
  onPost
}: any) {
  const tagOptions = TAG_OPTIONS[postType as keyof typeof TAG_OPTIONS] || TAG_OPTIONS.general;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-[60] p-4">
      <div className="bg-white rounded-lg shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Preview Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gray-50">
          <h3 className="text-lg font-semibold text-gray-800">Post Preview</h3>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
          >
            <i className="fas fa-times text-gray-600"></i>
          </button>
        </div>

        {/* Mock Post */}
        <div className="p-6">
          <div className="bg-white border border-gray-200 rounded-lg">
            {/* Post Header */}
            <div className="p-4 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full"></div>
                <div>
                  <div className="font-semibold text-gray-900">Your Name</div>
                  <div className="text-sm text-gray-500">
                    Just now • {visibility === 'public' ? '🌍 Public' : '🔒 Private'}
                  </div>
                </div>
              </div>
            </div>

            {/* Post Content */}
            <div className="p-4">
              {/* Caption */}
              {caption && (
                <p className="text-gray-900 whitespace-pre-wrap mb-3">{caption}</p>
              )}

              {/* Hashtags */}
              {hashtags.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-3">
                  {hashtags.map((tag: string) => (
                    <span key={tag} className="text-blue-600 hover:underline cursor-pointer">
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {/* Tagged People */}
              {taggedPeople.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3 items-center">
                  <span className="text-sm text-gray-600">with</span>
                  {taggedPeople.map((person: {id: string; name: string}) => (
                    <span
                      key={person.id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 text-sm rounded-full font-semibold border border-blue-200"
                    >
                      <i className="fas fa-user text-xs"></i>
                      {person.name}
                    </span>
                  ))}
                </div>
              )}

              {/* Tags */}
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-4">
                  {tags.map((tagValue: string) => {
                    const tag = tagOptions.find((t: any) => t.value === tagValue);
                    if (!tag) return null;
                    return (
                      <span
                        key={tagValue}
                        className={`px-2 py-1 bg-${tag.color}-100 text-${tag.color}-800 text-xs rounded-full font-medium`}
                      >
                        {tag.label}
                      </span>
                    );
                  })}
                </div>
              )}

              {/* Golf Scorecard Summary */}
              {postType === 'golf' && golfData && (
                <div className="mb-4 p-4 bg-green-50 rounded-lg border border-green-200">
                  <div className="flex items-center gap-2 mb-2">
                    <i className="fas fa-golf-ball text-green-600"></i>
                    <span className="font-semibold text-green-800">Golf Round</span>
                  </div>
                  <div className="text-sm text-green-700 space-y-1">
                    {golfData.courseName && <div><strong>Course:</strong> {golfData.courseName}</div>}
                    {golfData.holesData && (() => {
                      const scored = golfData.holesData.filter((h: any) => h.score !== undefined);
                      if (scored.length === 0) return null;
                      const total = scored.reduce((sum: number, h: any) => sum + h.score, 0);
                      const par = scored.reduce((sum: number, h: any) => sum + h.par, 0);
                      return (
                        <>
                          <div><strong>Score:</strong> {total} ({total - par >= 0 ? '+' : ''}{total - par})</div>
                          <div><strong>Holes Played:</strong> {scored.length}</div>
                        </>
                      );
                    })()}
                  </div>
                </div>
              )}

              {/* Media */}
              {mediaFiles.length > 0 && (
                <div className={`grid ${mediaFiles.length === 1 ? 'grid-cols-1' : 'grid-cols-2'} gap-1 rounded-lg overflow-hidden`}>
                  {mediaFiles.slice(0, 4).map((file: any, index: number) => (
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
                          <span className="text-white text-2xl font-bold">+{mediaFiles.length - 4}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Mock Engagement */}
            <div className="px-4 py-3 border-t border-gray-100 flex justify-between text-gray-500">
              <div className="flex gap-4">
                <button className="hover:text-blue-600 transition-colors">
                  <i className="far fa-heart mr-1"></i> Like
                </button>
                <button className="hover:text-blue-600 transition-colors">
                  <i className="far fa-comment mr-1"></i> Comment
                </button>
                <button className="hover:text-blue-600 transition-colors">
                  <i className="fas fa-share mr-1"></i> Share
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Preview Actions */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
          >
            Edit Post
          </button>
          <button
            onClick={onPost}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <i className="fas fa-paper-plane mr-2"></i>
            Post Now
          </button>
        </div>
      </div>
    </div>
  );
}