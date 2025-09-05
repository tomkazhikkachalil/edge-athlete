'use client';

import { useState, useCallback } from 'react';
import { getSportDefinition, getEnabledSports, type SportKey } from '@/lib/sports';
import { cssClasses } from '@/lib/design-tokens';
import { useToast } from '@/components/Toast';

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
}

// Golf specific data interfaces
interface GolfRoundData {
  date: string;
  course: string;
  tee: string;
  holes: number;
  grossScore?: number;
  par: number;
  firPercentage?: number;
  girPercentage?: number;
  totalPutts?: number;
  notes: string;
}

interface GolfHoleData {
  date: string;
  course: string;
  holeNumber: number;
  par: number;
  score?: number;
  distance: number;
  club: string;
  notes: string;
  fairwayInRegulation?: boolean;
  greenInRegulation?: boolean;
}

interface GolfData {
  mode: 'round_recap' | 'hole_highlight';
  roundData: GolfRoundData;
  holeData: GolfHoleData;
}

export default function CreatePostModal({ isOpen, onClose, userId, onPostCreated }: CreatePostModalProps) {
  const { showSuccess, showError } = useToast();
  
  // State management for single screen design
  const [selectedType, setSelectedType] = useState<string>('general');
  const [searchQuery, setSearchQuery] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  
  // Media management
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([]);
  const [uploading, setUploading] = useState(false);
  
  // Golf stats (sport-specific)
  const [golfData, setGolfData] = useState<GolfData>({
    mode: 'round_recap',
    roundData: {
      date: new Date().toISOString().split('T')[0],
      course: '',
      tee: '',
      holes: 18,
      grossScore: undefined,
      par: 72,
      firPercentage: undefined,
      girPercentage: undefined,
      totalPutts: undefined,
      notes: ''
    },
    holeData: {
      date: new Date().toISOString().split('T')[0],
      course: '',
      holeNumber: 1,
      par: 4,
      score: undefined,
      distance: 150,
      club: '',
      notes: '',
      fairwayInRegulation: undefined,
      greenInRegulation: undefined
    }
  });

  // Caption and visibility
  const [caption, setCaption] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const enabledSports = getEnabledSports();
  
  const reset = () => {
    setSelectedType('general');
    setSearchQuery('');
    setDropdownOpen(false);
    setMediaFiles([]);
    setGolfData({
      mode: 'round_recap',
      roundData: {
        date: new Date().toISOString().split('T')[0],
        course: '',
        tee: '',
        holes: 18,
        grossScore: undefined,
        par: 72,
        firPercentage: undefined,
        girPercentage: undefined,
        totalPutts: undefined,
        notes: ''
      },
      holeData: {
        date: new Date().toISOString().split('T')[0],
        course: '',
        holeNumber: 1,
        par: 4,
        score: undefined,
        distance: 150,
        club: '',
        notes: '',
        fairwayInRegulation: undefined,
        greenInRegulation: undefined
      }
    });
    setCaption('');
    setVisibility('public');
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleFileUpload = useCallback(async (files: FileList) => {
    if (files.length === 0) return;
    
    setUploading(true);
    
    try {
      const uploadPromises = Array.from(files).map(async (file) => {
        const formData = new FormData();
        formData.append('file', file);
        
        const response = await fetch('/api/upload', {
          method: 'POST',
          body: formData
        });
        
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Upload failed');
        }
        
        return await response.json();
      });
      
      const uploadedFiles = await Promise.all(uploadPromises);
      
      setMediaFiles(prev => [
        ...prev,
        ...uploadedFiles.map((file, index) => ({
          ...file,
          id: `${Date.now()}-${index}`
        }))
      ]);
      
      showSuccess('Files uploaded successfully');
    } catch (error) {
      showError('Upload failed', error instanceof Error ? error.message : 'Please try again');
    } finally {
      setUploading(false);
    }
  }, [showSuccess, showError]);

  const generateCaption = () => {
    if (selectedType === 'golf') {
      const { mode, roundData, holeData } = golfData;
      
      if (mode === 'round_recap' && roundData.grossScore) {
        let caption = `${roundData.grossScore}${roundData.course ? ` at ${roundData.course}` : ''}`;
        const stats: string[] = [];
        
        if (roundData.firPercentage !== undefined) {
          stats.push(`FIR ${Math.round(roundData.firPercentage)}%`);
        }
        if (roundData.girPercentage !== undefined) {
          stats.push(`GIR ${Math.round(roundData.girPercentage)}%`);
        }
        if (roundData.totalPutts !== undefined) {
          stats.push(`${roundData.totalPutts} putts`);
        }
        
        if (stats.length > 0) {
          caption += ` | ${stats.join(' | ')}`;
        }
        
        return caption;
      } else if (mode === 'hole_highlight' && holeData.score !== undefined) {
        const parDiff = holeData.score - holeData.par;
        let scoreName = '';
        if (parDiff === -2) scoreName = 'Eagle';
        else if (parDiff === -1) scoreName = 'Birdie';
        else if (parDiff === 0) scoreName = 'Par';
        else if (parDiff === 1) scoreName = 'Bogey';
        else if (parDiff === 2) scoreName = 'Double Bogey';
        else scoreName = `+${parDiff}`;
        
        return `Hole ${holeData.holeNumber}: ${scoreName} on Par ${holeData.par}`;
      }
    }
    
    return '';
  };

  const isValidForSubmission = () => {
    if (selectedType === 'general') {
      return mediaFiles.length > 0; // Media-only requires at least one file
    } else if (selectedType === 'golf') {
      if (golfData.mode === 'round_recap') {
        return golfData.roundData.grossScore !== undefined;
      } else if (golfData.mode === 'hole_highlight') {
        return golfData.holeData.score !== undefined;
      }
    }
    return false;
  };

  const handleSubmit = async () => {
    if (!isValidForSubmission()) return;
    
    setIsSubmitting(true);
    
    try {
      const payload = {
        userId,
        sportKey: selectedType,
        caption,
        visibility,
        golfData: selectedType === 'golf' ? golfData : null,
        mediaFiles: mediaFiles.map((file, index) => ({
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
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create post');
      }
      
      const result = await response.json();
      showSuccess('Post created successfully!');
      
      if (onPostCreated) {
        onPostCreated(result.post);
      }
      
      handleClose();
      
    } catch (error) {
      console.error('Post creation error:', error);
      showError('Failed to create post', error instanceof Error ? error.message : 'Please try again');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Build sports list - combine enabled sports with placeholders
  const allSports = [
    { display_name: 'Media Only', sportKey: 'general', icon_id: 'fas fa-camera', enabled: true },
    ...enabledSports.map(adapter => ({ 
      ...getSportDefinition(adapter.sportKey), 
      sportKey: adapter.sportKey, 
      enabled: true 
    })),
    { display_name: 'Hockey', sportKey: 'ice_hockey', icon_id: 'fas fa-hockey-puck', enabled: false },
    { display_name: 'Volleyball', sportKey: 'volleyball', icon_id: 'fas fa-volleyball-ball', enabled: false }
  ];
  
  // Filter sports based on search query (show all if no query)
  const filteredSports = searchQuery 
    ? allSports.filter(sport => 
        sport.display_name?.toLowerCase().includes(searchQuery.toLowerCase()) || 
        sport.sportKey.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : allSports;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-base border-b border-gray-200">
          <h2 className={`${cssClasses.TYPOGRAPHY.H2} text-gray-900`}>Create Post</h2>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-gray-100 rounded-md transition-colors"
            aria-label="Close modal"
          >
            <i className="fas fa-times text-gray-500"></i>
          </button>
        </div>

        {/* Single Screen Content */}
        <div className="p-base overflow-y-auto max-h-[calc(90vh-140px)]">
          <div className="space-y-section">
            {/* 1. Sport Selection Dropdown */}
            <div>
              <label className={`${cssClasses.TYPOGRAPHY.LABEL} text-gray-700 block mb-micro`}>
                Post Type
              </label>
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search sports or select Media only..."
                  value={searchQuery || (selectedType === 'general' ? 'Media Only' : getSportDefinition(selectedType as SportKey)?.display_name || '')}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setDropdownOpen(true);
                  }}
                  onFocus={() => setDropdownOpen(true)}
                  onBlur={(e) => {
                    // Delay to allow click on dropdown items
                    setTimeout(() => {
                      if (!e.currentTarget.contains(document.activeElement)) {
                        setDropdownOpen(false);
                      }
                    }, 200);
                  }}
                  className="w-full px-base py-micro border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  <i className={`fas fa-chevron-${dropdownOpen ? 'up' : 'down'}`}></i>
                </button>
              </div>
              
              {/* Dropdown Options */}
              {dropdownOpen && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {filteredSports.map(sport => (
                    <button
                      key={sport.sportKey}
                      onClick={() => {
                        setSelectedType(sport.sportKey);
                        setSearchQuery('');
                        setDropdownOpen(false);
                        if (!sport.enabled) {
                          showError('Coming Soon', `${sport.display_name} posting will be available soon!`);
                        }
                      }}
                      disabled={!sport.enabled}
                      className={`w-full px-base py-micro text-left hover:bg-gray-50 flex items-center space-x-micro ${
                        !sport.enabled ? 'opacity-60 cursor-not-allowed' : ''
                      }`}
                    >
                      <i className={`${sport.icon_id} text-lg ${sport.enabled ? 'text-green-600' : 'text-gray-400'}`}></i>
                      <span>{sport.display_name}</span>
                      {!sport.enabled && <span className="text-xs text-gray-500 ml-auto">Coming Soon</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 2. Media Upload Section (Always Visible) */}
            <div>
              <label className={`${cssClasses.TYPOGRAPHY.LABEL} text-gray-700 block mb-micro`}>
                Media {selectedType === 'general' ? '(Required)' : '(Optional)'}
              </label>
              
              {/* Upload Area */}
              <div
                onDrop={(e) => {
                  e.preventDefault();
                  handleFileUpload(e.dataTransfer.files);
                }}
                onDragOver={(e) => e.preventDefault()}
                className="border-2 border-dashed border-gray-300 rounded-lg p-base text-center hover:border-gray-400 transition-colors"
              >
                <i className="fas fa-cloud-upload-alt text-3xl text-gray-400 mb-micro"></i>
                <p className={`${cssClasses.TYPOGRAPHY.BODY} text-gray-600`}>
                  Drag and drop files here, or{' '}
                  <label className="text-blue-600 hover:text-blue-700 cursor-pointer">
                    browse
                    <input
                      type="file"
                      multiple
                      accept="image/*,video/*"
                      className="hidden"
                      onChange={(e) => e.target.files && handleFileUpload(e.target.files)}
                    />
                  </label>
                </p>
                <p className={`${cssClasses.TYPOGRAPHY.CHIP} text-gray-500 mt-1`}>
                  Images and videos up to 5MB each
                </p>
              </div>

              {/* Media Grid */}
              {mediaFiles.length > 0 && (
                <div className="mt-micro grid grid-cols-2 sm:grid-cols-3 gap-micro">
                  {mediaFiles.map((file) => (
                    <div key={file.id} className="relative aspect-square bg-gray-100 rounded-lg overflow-hidden">
                      {file.type === 'image' ? (
                        <img src={file.url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <video src={file.url} className="w-full h-full object-cover" />
                      )}
                      <button
                        onClick={() => setMediaFiles(prev => prev.filter(f => f.id !== file.id))}
                        className="absolute top-2 right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs hover:bg-red-600"
                      >
                        <i className="fas fa-times"></i>
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {uploading && (
                <div className="mt-micro flex items-center text-blue-600">
                  <i className="fas fa-spinner fa-spin mr-2"></i>
                  Uploading...
                </div>
              )}
            </div>

            {/* 3. Dynamic Stats Form (Golf Only for Now) */}
            {selectedType === 'golf' && (
              <div>
                <label className={`${cssClasses.TYPOGRAPHY.LABEL} text-gray-700 block mb-micro`}>
                  Golf Stats
                </label>
                
                {/* Golf Mode Selection */}
                <div className="flex space-x-micro mb-base">
                  <button
                    onClick={() => setGolfData(prev => ({ ...prev, mode: 'round_recap' }))}
                    className={`px-base py-micro rounded-lg border-2 transition-all ${
                      golfData.mode === 'round_recap'
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                    }`}
                  >
                    Round Recap
                  </button>
                  <button
                    onClick={() => setGolfData(prev => ({ ...prev, mode: 'hole_highlight' }))}
                    className={`px-base py-micro rounded-lg border-2 transition-all ${
                      golfData.mode === 'hole_highlight'
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
                    }`}
                  >
                    Hole Highlight
                  </button>
                </div>

                {/* Golf Stats Form */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-base">
                  {golfData.mode === 'round_recap' ? (
                    <>
                      <div>
                        <label className={`${cssClasses.TYPOGRAPHY.CHIP} text-gray-600 block mb-1`}>
                          Date *
                        </label>
                        <input
                          type="date"
                          value={golfData.roundData.date}
                          onChange={(e) => setGolfData(prev => ({
                            ...prev,
                            roundData: { ...prev.roundData, date: e.target.value }
                          }))}
                          className="w-full px-micro py-micro border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className={`${cssClasses.TYPOGRAPHY.CHIP} text-gray-600 block mb-1`}>
                          Course
                        </label>
                        <input
                          type="text"
                          placeholder="Course name"
                          value={golfData.roundData.course}
                          onChange={(e) => setGolfData(prev => ({
                            ...prev,
                            roundData: { ...prev.roundData, course: e.target.value }
                          }))}
                          className="w-full px-micro py-micro border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className={`${cssClasses.TYPOGRAPHY.CHIP} text-gray-600 block mb-1`}>
                          Score *
                        </label>
                        <input
                          type="number"
                          placeholder="Total score"
                          value={golfData.roundData.grossScore || ''}
                          onChange={(e) => setGolfData(prev => ({
                            ...prev,
                            roundData: { ...prev.roundData, grossScore: e.target.value ? parseInt(e.target.value) : undefined }
                          }))}
                          className="w-full px-micro py-micro border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className={`${cssClasses.TYPOGRAPHY.CHIP} text-gray-600 block mb-1`}>
                          Holes
                        </label>
                        <select
                          value={golfData.roundData.holes}
                          onChange={(e) => setGolfData(prev => ({
                            ...prev,
                            roundData: { ...prev.roundData, holes: parseInt(e.target.value) }
                          }))}
                          className="w-full px-micro py-micro border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        >
                          <option value={9}>9 holes</option>
                          <option value={18}>18 holes</option>
                        </select>
                      </div>
                      <div>
                        <label className={`${cssClasses.TYPOGRAPHY.CHIP} text-gray-600 block mb-1`}>
                          FIR %
                        </label>
                        <input
                          type="number"
                          placeholder="Fairways hit %"
                          min="0"
                          max="100"
                          value={golfData.roundData.firPercentage || ''}
                          onChange={(e) => setGolfData(prev => ({
                            ...prev,
                            roundData: { ...prev.roundData, firPercentage: e.target.value ? parseFloat(e.target.value) : undefined }
                          }))}
                          className="w-full px-micro py-micro border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className={`${cssClasses.TYPOGRAPHY.CHIP} text-gray-600 block mb-1`}>
                          GIR %
                        </label>
                        <input
                          type="number"
                          placeholder="Greens hit %"
                          min="0"
                          max="100"
                          value={golfData.roundData.girPercentage || ''}
                          onChange={(e) => setGolfData(prev => ({
                            ...prev,
                            roundData: { ...prev.roundData, girPercentage: e.target.value ? parseFloat(e.target.value) : undefined }
                          }))}
                          className="w-full px-micro py-micro border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className={`${cssClasses.TYPOGRAPHY.CHIP} text-gray-600 block mb-1`}>
                          Total Putts
                        </label>
                        <input
                          type="number"
                          placeholder="Total putts"
                          min="0"
                          value={golfData.roundData.totalPutts || ''}
                          onChange={(e) => setGolfData(prev => ({
                            ...prev,
                            roundData: { ...prev.roundData, totalPutts: e.target.value ? parseInt(e.target.value) : undefined }
                          }))}
                          className="w-full px-micro py-micro border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <label className={`${cssClasses.TYPOGRAPHY.CHIP} text-gray-600 block mb-1`}>
                          Date *
                        </label>
                        <input
                          type="date"
                          value={golfData.holeData.date}
                          onChange={(e) => setGolfData(prev => ({
                            ...prev,
                            holeData: { ...prev.holeData, date: e.target.value }
                          }))}
                          className="w-full px-micro py-micro border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className={`${cssClasses.TYPOGRAPHY.CHIP} text-gray-600 block mb-1`}>
                          Course
                        </label>
                        <input
                          type="text"
                          placeholder="Course name"
                          value={golfData.holeData.course}
                          onChange={(e) => setGolfData(prev => ({
                            ...prev,
                            holeData: { ...prev.holeData, course: e.target.value }
                          }))}
                          className="w-full px-micro py-micro border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className={`${cssClasses.TYPOGRAPHY.CHIP} text-gray-600 block mb-1`}>
                          Hole # *
                        </label>
                        <input
                          type="number"
                          min="1"
                          max="18"
                          value={golfData.holeData.holeNumber}
                          onChange={(e) => setGolfData(prev => ({
                            ...prev,
                            holeData: { ...prev.holeData, holeNumber: parseInt(e.target.value) }
                          }))}
                          className="w-full px-micro py-micro border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className={`${cssClasses.TYPOGRAPHY.CHIP} text-gray-600 block mb-1`}>
                          Par
                        </label>
                        <select
                          value={golfData.holeData.par}
                          onChange={(e) => setGolfData(prev => ({
                            ...prev,
                            holeData: { ...prev.holeData, par: parseInt(e.target.value) }
                          }))}
                          className="w-full px-micro py-micro border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        >
                          <option value={3}>Par 3</option>
                          <option value={4}>Par 4</option>
                          <option value={5}>Par 5</option>
                        </select>
                      </div>
                      <div>
                        <label className={`${cssClasses.TYPOGRAPHY.CHIP} text-gray-600 block mb-1`}>
                          Score *
                        </label>
                        <input
                          type="number"
                          min="1"
                          placeholder="Hole score"
                          value={golfData.holeData.score || ''}
                          onChange={(e) => setGolfData(prev => ({
                            ...prev,
                            holeData: { ...prev.holeData, score: e.target.value ? parseInt(e.target.value) : undefined }
                          }))}
                          className="w-full px-micro py-micro border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className={`${cssClasses.TYPOGRAPHY.CHIP} text-gray-600 block mb-1`}>
                          Club Used
                        </label>
                        <input
                          type="text"
                          placeholder="e.g., 7-iron, Driver"
                          value={golfData.holeData.club}
                          onChange={(e) => setGolfData(prev => ({
                            ...prev,
                            holeData: { ...prev.holeData, club: e.target.value }
                          }))}
                          className="w-full px-micro py-micro border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* 4. Caption & Visibility */}
            <div>
              <div className="flex items-center justify-between mb-micro">
                <label className={`${cssClasses.TYPOGRAPHY.LABEL} text-gray-700`}>
                  Caption
                </label>
                {selectedType === 'golf' && (
                  <button
                    onClick={() => setCaption(generateCaption())}
                    className="text-sm text-blue-600 hover:text-blue-700"
                  >
                    Generate from stats
                  </button>
                )}
              </div>
              <textarea
                placeholder="Write something..."
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                rows={3}
                className="w-full px-base py-micro border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
              />
              
              <div className="flex items-center justify-between mt-micro">
                <div className="flex items-center space-x-base">
                  <label className="flex items-center">
                    <input
                      type="radio"
                      name="visibility"
                      value="public"
                      checked={visibility === 'public'}
                      onChange={(e) => setVisibility(e.target.value as 'public' | 'private')}
                      className="mr-2"
                    />
                    <span className={`${cssClasses.TYPOGRAPHY.CHIP} text-gray-700`}>Public</span>
                  </label>
                  <label className="flex items-center">
                    <input
                      type="radio"
                      name="visibility"
                      value="private"
                      checked={visibility === 'private'}
                      onChange={(e) => setVisibility(e.target.value as 'public' | 'private')}
                      className="mr-2"
                    />
                    <span className={`${cssClasses.TYPOGRAPHY.CHIP} text-gray-700`}>Private</span>
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Buttons */}
        <div className="flex items-center justify-between p-base border-t border-gray-200">
          <button
            onClick={handleClose}
            className="px-base py-micro text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!isValidForSubmission() || isSubmitting}
            className="px-base py-micro text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSubmitting ? (
              <span className="flex items-center">
                <i className="fas fa-spinner fa-spin mr-2"></i>
                Creating...
              </span>
            ) : (
              'Create Post'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}