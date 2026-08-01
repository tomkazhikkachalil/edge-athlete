'use client';

import { useState, useRef } from 'react';
import { Upload, X, Loader2 } from 'lucide-react';
import Image from 'next/image';
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
}

export default function EquipmentImageUpload({
  value,
  onChange,
}: EquipmentImageUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      // POST /api/upload/equipment — the server owns the bucket, the path and
      // the size/MIME re-check. This used to upload straight to a bucket named
      // `media`, which does not exist in this project, so it always failed.
      const formData = new FormData();
      formData.append('image', file);
      const response = await fetch('/api/upload/equipment', {
        method: 'POST',
        body: formData,
      });
      const payload = await response.json();
      if (!response.ok) {
        setUploadError(payload.error || 'Failed to upload image');
        return;
      }

      onChange(payload.image_url);
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

      {/* Helper text */}
      <p className="text-xs text-gray-500">
        {uploading
          ? 'Uploading your image...'
          : 'Upload a photo of your gear. Max 5MB.'}
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
