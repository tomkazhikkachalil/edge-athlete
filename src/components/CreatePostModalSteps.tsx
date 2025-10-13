'use client';

import { cssClasses } from '@/lib/design-tokens';
import { getSportDefinition, type SportKey } from '@/lib/sports';
import EnhancedGolfForm from '@/components/EnhancedGolfForm';

interface MediaFile {
  id: string;
  url: string;
  type: 'image' | 'video';
  size: number;
  name: string;
  thumbnailUrl?: string;
}

interface GolfData {
  mode: 'round_recap' | 'hole_highlight';
  roundData?: {
    date: string;
    course: string;
    tee?: string;
    holes: 9 | 18;
    grossScore?: number;
    par: number;
    firPercentage?: number;
    girPercentage?: number;
    totalPutts?: number;
    notes?: string;
  };
  holeData?: {
    date: string;
    course?: string;
    holeNumber: number;
    par?: number;
    strokes?: number;
    putts?: number;
    fairwayHit?: boolean;
    greenInRegulation?: boolean;
  };
}

interface StepContentProps {
  currentStep: string;
  selectedType: string;
  mediaFiles: MediaFile[];
  uploading: boolean;
  golfData: GolfData;
  caption: string;
  visibility: 'public' | 'private';
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveMedia: (fileId: string) => void;
  onGolfDataChange: (data: Partial<GolfData>) => void;
  onCaptionChange: (caption: string) => void;
  onVisibilityChange: (visibility: 'public' | 'private') => void;
  generateSuggestedCaption: () => string;
}

export function StepContent({
  currentStep,
  selectedType,
  mediaFiles,
  uploading,
  caption,
  visibility,
  onDrop,
  onFileSelect,
  onRemoveMedia,
  onGolfDataChange,
  onCaptionChange,
  onVisibilityChange,
  generateSuggestedCaption
}: StepContentProps) {

  /* Step 2: Media Upload */
  if (currentStep === 'media') {
    return (
      <div className="space-y-base">
        <div>
          <h3 className={`${cssClasses.TYPOGRAPHY.H3} text-gray-900 mb-micro`}>Add Media</h3>
          <p className={`${cssClasses.TYPOGRAPHY.LABEL} text-gray-600`}>
            {selectedType === 'general' 
              ? 'Add photos and videos to your post (required)'
              : 'Add photos and videos to your post (optional)'
            }
          </p>
        </div>

        {/* Upload Zone */}
        <div
          onDrop={onDrop}
          onDragOver={(e) => e.preventDefault()}
          onDragEnter={(e) => e.preventDefault()}
          className="border-2 border-dashed border-gray-300 rounded-lg p-base text-center hover:border-gray-400 transition-colors"
        >
          <input
            type="file"
            id="file-upload"
            multiple
            accept="image/*,video/*"
            onChange={onFileSelect}
            className="hidden"
          />
          
          {uploading ? (
            <div className="space-y-micro">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
              <p className={`${cssClasses.TYPOGRAPHY.LABEL} text-gray-600`}>Uploading files...</p>
            </div>
          ) : (
            <div className="space-y-micro">
              <i className="fas fa-cloud-upload-alt text-3xl text-gray-400"></i>
              <div>
                <p className={`${cssClasses.TYPOGRAPHY.BODY} text-gray-700`}>
                  Drag & drop files here, or{' '}
                  <label htmlFor="file-upload" className="text-blue-600 hover:text-blue-700 cursor-pointer underline">
                    browse
                  </label>
                </p>
                <p className={`${cssClasses.TYPOGRAPHY.CHIP} text-gray-500`}>
                  Support for JPG, PNG, GIF, WebP, MP4, MOV, WebM • Max 50MB per file
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Media Preview Grid */}
        {mediaFiles.length > 0 && (
          <div className="space-y-micro">
            <h4 className={`${cssClasses.TYPOGRAPHY.BODY} font-medium text-gray-900`}>
              Media Files ({mediaFiles.length})
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-micro">
              {mediaFiles.map((file) => (
                <div
                  key={file.id}
                  className="relative group bg-gray-100 rounded-lg overflow-hidden aspect-square"
                >
                  {file.type === 'image' ? (
                    <img
                      src={file.url}
                      alt={file.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gray-800 text-white">
                      <i className="fas fa-play-circle text-2xl"></i>
                    </div>
                  )}
                  
                  <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-50 transition-all">
                    <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => onRemoveMedia(file.id)}
                        className="w-8 h-8 bg-red-600 text-white rounded-full flex items-center justify-center hover:bg-red-700 transition-colors"
                        aria-label="Remove file"
                      >
                        <i className="fas fa-times text-sm"></i>
                      </button>
                    </div>
                  </div>
                  
                  <div className="absolute bottom-2 left-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <p className={`${cssClasses.TYPOGRAPHY.CHIP} text-white truncate`}>
                      {file.name}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  /* Step 3: Sport-specific Stats */
  if (currentStep === 'stats') {
    if (selectedType === 'golf') {
      return (
        <EnhancedGolfForm
          onDataChange={onGolfDataChange}
        />
      );
    } else {
      // Future sports - coming soon
      // Safe type assertion - selectedType is validated in parent component
      const sport = getSportDefinition(selectedType as SportKey);
      return (
        <div className="space-y-base">
          <div className="text-center py-base">
            <i className={`${sport.icon_id} text-4xl text-gray-300 mb-micro`}></i>
            <h3 className={`${cssClasses.TYPOGRAPHY.H3} text-gray-900 mb-micro`}>
              {sport.display_name} Stats Coming Soon
            </h3>
            <p className={`${cssClasses.TYPOGRAPHY.LABEL} text-gray-600 mb-base`}>
              Detailed {sport.display_name.toLowerCase()} stats tracking will be available soon!
            </p>
            <div className="inline-flex items-center px-3 py-2 bg-amber-50 border border-amber-200 rounded-md">
              <i className="fas fa-clock text-amber-600 mr-2"></i>
              <span className={`${cssClasses.TYPOGRAPHY.CHIP} text-amber-800 font-medium`}>Coming Soon</span>
            </div>
          </div>
        </div>
      );
    }
  }

  /* Step 4: Caption and Visibility */
  if (currentStep === 'caption') {
    const suggestedCaption = generateSuggestedCaption();
    
    return (
      <div className="space-y-base">
        <div>
          <h3 className={`${cssClasses.TYPOGRAPHY.H3} text-gray-900 mb-micro`}>Caption & Publish</h3>
          <p className={`${cssClasses.TYPOGRAPHY.LABEL} text-gray-600`}>
            Add a caption and choose who can see your post
          </p>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className={`block ${cssClasses.TYPOGRAPHY.LABEL} font-medium text-gray-700`}>
              Caption
            </label>
            {suggestedCaption && (
              <button
                onClick={() => onCaptionChange(suggestedCaption)}
                className={`${cssClasses.TYPOGRAPHY.CHIP} text-blue-600 hover:text-blue-700 underline`}
              >
                Use suggested
              </button>
            )}
          </div>
          
          <textarea
            value={caption}
            onChange={(e) => onCaptionChange(e.target.value)}
            className="w-full px-3 py-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            rows={4}
            placeholder={
              selectedType === 'golf' 
                ? "Share your round experience..."
                : selectedType === 'general'
                  ? "Tell your story..."
                  : "Share your performance..."
            }
          />
          <div className={`flex items-center justify-between mt-1`}>
            <span className={`${cssClasses.TYPOGRAPHY.CHIP} text-gray-500`}>
              {caption.length}/2000 characters
            </span>
            {suggestedCaption && (
              <span className={`${cssClasses.TYPOGRAPHY.CHIP} text-gray-500 italic`}>
                Suggestion: {suggestedCaption.substring(0, 50)}{suggestedCaption.length > 50 ? '...' : ''}
              </span>
            )}
          </div>
        </div>

        <div>
          <label className={`block ${cssClasses.TYPOGRAPHY.LABEL} font-medium text-gray-700 mb-2`}>
            Who can see this post?
          </label>
          <div className="space-y-2">
            <label className="flex items-center">
              <input
                type="radio"
                name="visibility"
                value="public"
                checked={visibility === 'public'}
                onChange={(e) => onVisibilityChange(e.target.value as 'public' | 'private')}
                className="sr-only"
              />
              <div className={`w-4 h-4 border-2 rounded-full mr-3 flex items-center justify-center ${
                visibility === 'public' ? 'border-blue-600' : 'border-gray-300'
              }`}>
                {visibility === 'public' && <div className="w-2 h-2 bg-blue-600 rounded-full"></div>}
              </div>
              <div>
                <div className={`${cssClasses.TYPOGRAPHY.BODY} font-medium text-gray-900`}>Public</div>
                <div className={`${cssClasses.TYPOGRAPHY.CHIP} text-gray-500`}>Anyone can see this post</div>
              </div>
            </label>
            
            <label className="flex items-center">
              <input
                type="radio"
                name="visibility"
                value="private"
                checked={visibility === 'private'}
                onChange={(e) => onVisibilityChange(e.target.value as 'public' | 'private')}
                className="sr-only"
              />
              <div className={`w-4 h-4 border-2 rounded-full mr-3 flex items-center justify-center ${
                visibility === 'private' ? 'border-blue-600' : 'border-gray-300'
              }`}>
                {visibility === 'private' && <div className="w-2 h-2 bg-blue-600 rounded-full"></div>}
              </div>
              <div>
                <div className={`${cssClasses.TYPOGRAPHY.BODY} font-medium text-gray-900`}>Private</div>
                <div className={`${cssClasses.TYPOGRAPHY.CHIP} text-gray-500`}>Only you can see this post</div>
              </div>
            </label>
          </div>
        </div>

        {/* Post Preview */}
        <div className="border border-gray-200 rounded-lg p-base bg-gray-50">
          <h4 className={`${cssClasses.TYPOGRAPHY.BODY} font-medium text-gray-900 mb-micro`}>Preview</h4>
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <i className={`fas fa-globe text-sm ${visibility === 'public' ? 'text-green-600' : 'text-gray-400'}`}></i>
              <span className={`${cssClasses.TYPOGRAPHY.CHIP} text-gray-600`}>
                {visibility === 'public' ? 'Public post' : 'Private post'}
              </span>
              {selectedType !== 'general' && (
                <>
                  <span className={`${cssClasses.TYPOGRAPHY.CHIP} text-gray-400`}>•</span>
                  <i className={`${getSportDefinition(selectedType as SportKey).icon_id} text-sm text-blue-600`}></i>
                  <span className={`${cssClasses.TYPOGRAPHY.CHIP} text-gray-600`}>
                    {getSportDefinition(selectedType as SportKey).display_name}
                  </span>
                </>
              )}
            </div>
            <p className={`${cssClasses.TYPOGRAPHY.BODY} text-gray-700`}>
              {caption || (
                <span className="italic text-gray-500">
                  {selectedType === 'golf' 
                    ? "Share your round experience..."
                    : selectedType === 'general'
                      ? "Tell your story..."
                      : "Share your performance..."
                  }
                </span>
              )}
            </p>
            {mediaFiles.length > 0 && (
              <div className="flex items-center space-x-2">
                <i className="fas fa-photo-video text-sm text-blue-600"></i>
                <span className={`${cssClasses.TYPOGRAPHY.CHIP} text-gray-600`}>
                  {mediaFiles.length} media file{mediaFiles.length !== 1 ? 's' : ''}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return null;
}