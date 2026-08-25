'use client';

import { useState } from 'react';
import { cssFilterString, PRESET_FILTERS } from '@/lib/media/filters';
import { uiToUnsigned, unsignedToUi } from '@/lib/media/slider-scale';
import type { Look } from '@/lib/media/look';
import ConfirmModal from '@/components/ConfirmModal';
import EditorSlider from './EditorSlider';

export interface UserPreset {
  id: string;
  name: string;
  look: Look;
}

interface FilterStripProps {
  imageUrl: string;
  activeFilterId: string | null;
  /** 0..1 preset intensity; the slider appears when a filter is active. */
  filterStrength: number;
  onSelect: (filterId: string | null) => void;
  onStrengthChange: (strength: number) => void;
  /** Saved looks (E-W3). Empty before migration 121 / for new users. */
  userPresets: UserPreset[];
  onApplyPreset: (preset: UserPreset) => void;
  onSavePreset: (name: string) => void;
  onDeletePreset: (preset: UserPreset) => void;
  savingPreset: boolean;
}

/** Preset thumbnails — tiny <img>s with CSS filters; no canvas thumbnails. */
export default function FilterStrip({
  imageUrl,
  activeFilterId,
  filterStrength,
  onSelect,
  onStrengthChange,
  userPresets,
  onApplyPreset,
  onSavePreset,
  onDeletePreset,
  savingPreset,
}: FilterStripProps) {
  // null = not naming; '' = input open and empty.
  const [savingName, setSavingName] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<UserPreset | null>(null);
  const options: Array<{ id: string | null; label: string; filter: string }> = [
    { id: null, label: 'Original', filter: '' },
    ...PRESET_FILTERS.map(p => ({
      id: p.id as string | null,
      label: p.label,
      filter: cssFilterString(p.adjustments),
    })),
  ];

  return (
    <div className="w-full">
      {activeFilterId !== null && (
        <div className="px-4 pt-2 w-full max-w-xl mx-auto">
          <EditorSlider
            label="Intensity"
            value={unsignedToUi(filterStrength)}
            min={0}
            onChange={ui => onStrengthChange(uiToUnsigned(ui))}
          />
        </div>
      )}
      <div className="flex gap-3 px-4 py-3 overflow-x-auto scrollbar-hide sm:justify-center">
        {options.map(option => (
          <button
            key={option.label}
            type="button"
            onClick={() => onSelect(option.id)}
            className="flex flex-col items-center gap-1 flex-shrink-0"
          >
            {/* Raw <img>: blob: object URL the optimizer cannot fetch, and
                the CSS style={{filter}} below IS the preset preview — it
                must reach the element verbatim. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt={`${option.label} filter preview`}
              style={option.filter ? { filter: option.filter } : undefined}
              className={`w-16 h-16 rounded-lg object-cover ${
                activeFilterId === option.id ? 'ring-2 ring-violet-500' : 'ring-1 ring-white/20'
              }`}
            />
            <span
              className={`text-chip ${activeFilterId === option.id ? 'text-white' : 'text-white/60'}`}
            >
              {option.label}
            </span>
          </button>
        ))}
      </div>

      {/* Saved looks (E-W3): apply, save the current look, delete. */}
      <div className="flex items-center gap-2 px-4 pb-2 overflow-x-auto scrollbar-hide w-full max-w-xl mx-auto">
        <span className="text-chip text-white/50 shrink-0">My presets</span>
        {userPresets.map(preset => (
          <span key={preset.id} className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              onClick={() => onApplyPreset(preset)}
              className="px-3 min-h-[36px] rounded-l-full rounded-r-none text-chip whitespace-nowrap max-w-[8rem] truncate bg-white/10 text-white/80 hover:bg-white/20"
            >
              {preset.name}
            </button>
            <button
              type="button"
              aria-label={`Delete preset ${preset.name}`}
              onClick={() => setConfirmDelete(preset)}
              className="min-h-[36px] px-2 rounded-r-full rounded-l-none text-chip bg-white/10 text-white/50 hover:bg-white/20 hover:text-white"
            >
              ×
            </button>
          </span>
        ))}
        {savingName === null ? (
          <button
            type="button"
            onClick={() => setSavingName('')}
            disabled={savingPreset}
            className="px-3 min-h-[36px] rounded-full text-chip whitespace-nowrap shrink-0 bg-white/10 text-white/70 hover:bg-white/20 disabled:opacity-40"
          >
            + Save look
          </button>
        ) : (
          <form
            className="flex items-center gap-1 shrink-0"
            onSubmit={e => {
              e.preventDefault();
              const name = savingName.trim();
              if (name.length === 0) return;
              onSavePreset(name);
              setSavingName(null);
            }}
          >
            <input
              type="text"
              value={savingName}
              onChange={e => setSavingName(e.target.value)}
              maxLength={40}
              autoFocus
              aria-label="Preset name"
              placeholder="Preset name"
              className="w-32 min-h-[36px] px-3 rounded-full bg-white/10 text-white text-chip placeholder-white/40"
            />
            <button
              type="submit"
              className="px-3 min-h-[36px] rounded-full text-chip bg-brand text-white font-semibold hover:bg-brand-hover"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setSavingName(null)}
              aria-label="Cancel saving preset"
              className="px-2 min-h-[36px] rounded-full text-chip text-white/60 hover:text-white"
            >
              ×
            </button>
          </form>
        )}
      </div>

      <ConfirmModal
        isOpen={confirmDelete !== null}
        title="Delete preset?"
        message={
          confirmDelete
            ? `“${confirmDelete.name}” will be gone from every editing session.`
            : ''
        }
        confirmText="Yes, delete"
        cancelText="Keep it"
        overlayZClass="z-[75]"
        onConfirm={() => {
          if (confirmDelete) onDeletePreset(confirmDelete);
          setConfirmDelete(null);
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}
