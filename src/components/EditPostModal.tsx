'use client';

import { useState, useRef, useEffect } from 'react';
import { useToast } from '@/components/Toast';

interface Post {
  id: string;
  caption: string | null;
  sport_key: string | null;
  visibility: string;
  tags?: string[];
  hashtags?: string[];
}

interface EditPostModalProps {
  isOpen: boolean;
  onClose: () => void;
  post: Post;
  onPostUpdated?: (post: unknown) => void;
}

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

// Popular hashtags suggestions
const HASHTAG_SUGGESTIONS = {
  general: ['#Athletics', '#SportLife', '#Training', '#Fitness', '#Athlete', '#PersonalBest', '#GameDay', '#Champions'],
  golf: ['#Golf', '#GolfLife', '#GolfSwing', '#GolfCourse', '#Birdie', '#Eagle', '#Par', '#HoleInOne', '#PGA', '#18Holes']
};

export default function EditPostModal({
  isOpen,
  onClose,
  post,
  onPostUpdated
}: EditPostModalProps) {
  const { showSuccess, showError } = useToast();
  const captionRef = useRef<HTMLTextAreaElement>(null);

  const [caption, setCaption] = useState(post.caption || '');
  const [selectedTags, setSelectedTags] = useState<string[]>(post.tags || []);
  const [hashtags, setHashtags] = useState<string[]>(post.hashtags || []);
  const [visibility, setVisibility] = useState(post.visibility || 'public');
  const [showHashtagSuggestions, setShowHashtagSuggestions] = useState(false);
  const [customHashtag, setCustomHashtag] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const postType = post.sport_key || 'general';
  const currentTags = TAG_OPTIONS[postType as keyof typeof TAG_OPTIONS] || TAG_OPTIONS.general;
  const currentHashtagSuggestions = HASHTAG_SUGGESTIONS[postType as keyof typeof HASHTAG_SUGGESTIONS] || HASHTAG_SUGGESTIONS.general;

  // Reset form when post changes
  useEffect(() => {
    setCaption(post.caption || '');
    setSelectedTags(post.tags || []);
    setHashtags(post.hashtags || []);
    setVisibility(post.visibility || 'public');
  }, [post]);

  const toggleTag = (tagValue: string) => {
    setSelectedTags(prev =>
      prev.includes(tagValue)
        ? prev.filter(t => t !== tagValue)
        : [...prev, tagValue]
    );
  };

  const addHashtag = (tag: string) => {
    const formattedTag = tag.startsWith('#') ? tag : `#${tag}`;
    if (!hashtags.includes(formattedTag)) {
      setHashtags([...hashtags, formattedTag]);
    }
    setCustomHashtag('');
    setShowHashtagSuggestions(false);
  };

  const removeHashtag = (tag: string) => {
    setHashtags(hashtags.filter(h => h !== tag));
  };

  const handleCustomHashtagSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (customHashtag.trim()) {
      addHashtag(customHashtag.trim());
    }
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/posts', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          postId: post.id,
          caption: caption.trim(),
          tags: selectedTags,
          hashtags: hashtags,
          visibility: visibility
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update post');
      }

      showSuccess(data.message || 'Post updated successfully!');

      if (onPostUpdated) {
        onPostUpdated(data.post);
      }

      onClose();
    } catch (error) {
      console.error('Error updating post:', error);
      showError(error instanceof Error ? error.message : 'Failed to update post');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">Edit Post</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <i className="fas fa-times text-xl"></i>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Caption */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Caption
            </label>
            <textarea
              ref={captionRef}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Write your caption here..."
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[120px] resize-none"
            />
          </div>

          {/* Tags */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Tags
            </label>
            <div className="flex flex-wrap gap-2">
              {currentTags.map((tag) => (
                <button
                  key={tag.value}
                  onClick={() => toggleTag(tag.value)}
                  className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                    selectedTags.includes(tag.value)
                      ? `bg-${tag.color}-500 text-white`
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {tag.label}
                </button>
              ))}
            </div>
          </div>

          {/* Hashtags */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Hashtags
            </label>

            {/* Selected Hashtags */}
            {hashtags.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {hashtags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-2 px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-sm"
                  >
                    {tag}
                    <button
                      onClick={() => removeHashtag(tag)}
                      className="hover:text-blue-900"
                    >
                      <i className="fas fa-times text-xs"></i>
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Add Custom Hashtag */}
            <form onSubmit={handleCustomHashtagSubmit} className="relative mb-3">
              <input
                type="text"
                value={customHashtag}
                onChange={(e) => setCustomHashtag(e.target.value)}
                onFocus={() => setShowHashtagSuggestions(true)}
                placeholder="Add custom hashtag..."
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {customHashtag && (
                <button
                  type="submit"
                  className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600"
                >
                  Add
                </button>
              )}
            </form>

            {/* Hashtag Suggestions */}
            {showHashtagSuggestions && (
              <div className="mb-3">
                <p className="text-xs text-gray-500 mb-2">Popular suggestions:</p>
                <div className="flex flex-wrap gap-2">
                  {currentHashtagSuggestions
                    .filter(tag => !hashtags.includes(tag))
                    .map((tag) => (
                      <button
                        key={tag}
                        onClick={() => addHashtag(tag)}
                        className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs hover:bg-gray-200 transition-colors"
                      >
                        {tag}
                      </button>
                    ))}
                </div>
              </div>
            )}
          </div>

          {/* Visibility */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Privacy
            </label>
            <div className="flex gap-4">
              <button
                onClick={() => setVisibility('public')}
                className={`flex-1 px-4 py-3 rounded-lg border-2 transition-all ${
                  visibility === 'public'
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center justify-center gap-2">
                  <i className="fas fa-globe text-lg"></i>
                  <span className="font-medium">Public</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">Anyone can see this post</p>
              </button>
              <button
                onClick={() => setVisibility('private')}
                className={`flex-1 px-4 py-3 rounded-lg border-2 transition-all ${
                  visibility === 'private'
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center justify-center gap-2">
                  <i className="fas fa-lock text-lg"></i>
                  <span className="font-medium">Private</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">Only you can see this</p>
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-200 flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="px-6 py-2 border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="px-6 py-2 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {isSubmitting ? (
              <>
                <i className="fas fa-spinner fa-spin"></i>
                Updating...
              </>
            ) : (
              <>
                <i className="fas fa-check"></i>
                Update Post
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
