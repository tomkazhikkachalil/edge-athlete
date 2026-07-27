'use client';

import { useState, useRef } from 'react';
import { Upload, X, Loader2, Image as ImageIcon } from 'lucide-react';
import Image from 'next/image';
import { createBrowserClient } from '@supabase/ssr';
import { MediaEditor } from '@/components/media-editor';
import { validateFiles } from '@/lib/media/validation';
import type { EditedMedia, EditorConfig, MediaAsset } from '@/lib/media/types';

const EQUIPMENT_EDITOR_CONFIG: EditorConfig = {
  aspectRatios: ['1:1', 'free'],
  allowVideo: false,
  maxAssets: 1,
  output: { maxDimension: 1200, mime: 'image/jpeg', quality: 0.85 },
};

interface EquipmentImageUploadProps {
  value: string;
  onChange: (url: string) => void;
  presetImages?: string[];
  onSelectPreset?: (url: string) => void;
}

export default function EquipmentImageUpload({
  value,
  onChange,
  presetImages = [],
  onSelectPreset,
}: EquipmentImageUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showPresets, setShowPresets] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // Picked file goes through the shared media editor (square crop for
  // consistent equipment tiles) before uploading.
  const [editorAssets, setEditorAssets] = useState<MediaAsset[] | null>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const { accepted, rejected } = validateFiles([file], {
      maxBytes: 5 * 1024 * 1024,
      allowVideo: false,
      maxCount: 1,
    });
    if (rejected.length > 0) {
      setUploadError(rejected[0].message);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    setUploadError(null);
    setEditorAssets([{ id: `${Date.now()}`, file: accepted[0], kind: 'image' }]);
  };

  const handleEditorDone = async (results: EditedMedia[]) => {
    setEditorAssets(null);
    const result = results[0];
    if (!result) return;
    const file = result.file;
    URL.revokeObjectURL(result.previewUrl);

    setUploading(true);
    setUploadError(null);

    try {
      // Generate unique filename
      const fileExt = file.name.split('.').pop();
      const fileName = `${Math.random().toString(36).substring(2)}-${Date.now()}.${fileExt}`;
      const filePath = `equipment-images/${fileName}`;

      // Upload to Supabase storage
      const { error } = await supabase.storage
        .from('media')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false,
        });

      if (error) {
        throw error;
      }

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('media')
        .getPublicUrl(filePath);

      onChange(publicUrl);
    } catch (err) {
      console.error('Upload error:', err);
      setUploadError(err instanceof Error ? err.message : 'Failed to upload image');
    } finally {
      setUploading(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleRemove = () => {
    onChange('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handlePresetSelect = (presetUrl: string) => {
    onChange(presetUrl);
    setShowPresets(false);
    if (onSelectPreset) {
      onSelectPreset(presetUrl);
    }
  };

  return (
    <div className="space-y-3">
      {/* Image Preview */}
      {value && (
        <div className="relative w-full aspect-video bg-gray-100 rounded-lg overflow-hidden">
          <Image
            src={value}
            alt="Equipment"
            fill
            className="object-contain"
            unoptimized
          />
          <button
            type="button"
            onClick={handleRemove}
            className="absolute top-2 right-2 p-1.5 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors shadow-lg z-10"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Upload Controls */}
      <div className="flex items-center gap-2">
        {/* Upload Button */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 border-2 border-dashed border-gray-300 rounded-lg hover:border-violet-500 hover:bg-violet-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {uploading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin text-violet-600" />
              <span className="text-sm font-medium text-gray-700">Uploading...</span>
            </>
          ) : (
            <>
              <Upload className="w-5 h-5 text-gray-400" />
              <span className="text-sm font-medium text-gray-700">
                {value ? 'Change Image' : 'Upload Image'}
              </span>
            </>
          )}
        </button>

        {/* Preset Images Button */}
        {presetImages.length > 0 && (
          <button
            type="button"
            onClick={() => setShowPresets(!showPresets)}
            className="px-4 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2"
          >
            <ImageIcon className="w-5 h-5 text-gray-400" />
            <span className="text-sm font-medium text-gray-700">Presets</span>
          </button>
        )}
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        className="hidden"
      />

      {/* Upload error */}
      {uploadError && (
        <p className="text-xs text-red-600">{uploadError}</p>
      )}

      {/* Preset images grid or no presets message */}
      {showPresets && (
        <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-gray-700">
              {presetImages.length > 0 ? 'Select a preset image:' : 'Preset Images'}
            </p>
            <button
              type="button"
              onClick={() => setShowPresets(false)}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              Close
            </button>
          </div>

          {presetImages.length > 0 ? (
            <div className="grid grid-cols-3 gap-2">
              {presetImages.map((presetUrl, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => handlePresetSelect(presetUrl)}
                  className={`relative aspect-video bg-white border-2 rounded-lg overflow-hidden hover:border-violet-500 transition-colors ${
                    value === presetUrl ? 'border-violet-500 ring-2 ring-violet-200' : 'border-gray-200'
                  }`}
                >
                  <Image
                    src={presetUrl}
                    alt={`Preset ${index + 1}`}
                    fill
                    className="object-contain p-1"
                    unoptimized
                  />
                </button>
              ))}
            </div>
          ) : (
            <div className="text-center py-6">
              <ImageIcon className="w-12 h-12 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-600 font-medium mb-1">
                No preset images available
              </p>
              <p className="text-xs text-gray-500">
                This brand/model combination doesn&apos;t have preset images yet. Upload your own photo instead!
              </p>
            </div>
          )}
        </div>
      )}

      {/* Helper text */}
      <p className="text-xs text-gray-500">
        {uploading
          ? 'Uploading your image...'
          : 'Upload your own photo or select from presets. Max 5MB.'}
      </p>

      {/* Shared media editor (z-[65]) */}
      {editorAssets && (
        <MediaEditor
          assets={editorAssets}
          config={EQUIPMENT_EDITOR_CONFIG}
          onDone={handleEditorDone}
          onCancel={() => {
            setEditorAssets(null);
            if (fileInputRef.current) fileInputRef.current.value = '';
          }}
        />
      )}
    </div>
  );
}
