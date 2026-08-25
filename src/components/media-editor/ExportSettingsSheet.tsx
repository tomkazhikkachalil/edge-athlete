'use client';

/**
 * Export settings (Phase 4 E-W2): quality / size / format for this
 * session's photo exports. Size only clamps below the surface cap;
 * choices persist across sessions (localStorage, versioned key).
 */

import type { ExportFormat, ExportPrefs, ExportQuality, ExportSize } from '@/lib/media/export-prefs';

interface ExportSettingsSheetProps {
  prefs: ExportPrefs;
  /** The surface's longest-edge cap (user choices never exceed it). */
  surfaceMax: number;
  onChange: (prefs: ExportPrefs) => void;
  onClose: () => void;
}

const QUALITY_OPTIONS: Array<{ id: ExportQuality; label: string; hint: string }> = [
  { id: 'high', label: 'High', hint: 'best quality' },
  { id: 'balanced', label: 'Balanced', hint: 'smaller files' },
  { id: 'compact', label: 'Compact', hint: 'smallest files' },
];

const SIZE_OPTIONS: Array<{ id: ExportSize; label: (max: number) => string }> = [
  { id: 'max', label: max => `Maximum (${max}px)` },
  { id: 'medium', label: () => 'Medium (1280px)' },
  { id: 'small', label: () => 'Small (720px)' },
];

const FORMAT_OPTIONS: Array<{ id: ExportFormat; label: string }> = [
  { id: 'jpeg', label: 'JPEG' },
  { id: 'webp', label: 'WebP' },
  { id: 'png', label: 'PNG' },
];

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`px-3 min-h-[36px] rounded-full text-chip whitespace-nowrap shrink-0 ${
        active ? 'bg-white/20 text-white font-semibold' : 'bg-white/10 text-white/70 hover:bg-white/20'
      }`}
    >
      {children}
    </button>
  );
}

export default function ExportSettingsSheet({
  prefs,
  surfaceMax,
  onChange,
  onClose,
}: ExportSettingsSheetProps) {
  return (
    <div className="fixed inset-0 z-[68]" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        role="dialog"
        aria-label="Export settings"
        className="absolute bottom-0 inset-x-0 rounded-t-2xl bg-neutral-900 p-4 pb-6 safe-bottom space-y-3"
        onClick={e => e.stopPropagation()}
      >
        <p className="text-label font-semibold text-white">Export settings</p>
        <div className="space-y-1">
          <p className="text-chip text-white/50">Quality</p>
          <div className="flex gap-2 overflow-x-auto scrollbar-hide">
            {QUALITY_OPTIONS.map(option => (
              <Chip
                key={option.id}
                active={prefs.quality === option.id}
                onClick={() => onChange({ ...prefs, quality: option.id })}
              >
                {option.label} · {option.hint}
              </Chip>
            ))}
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-chip text-white/50">Size</p>
          <div className="flex gap-2 overflow-x-auto scrollbar-hide">
            {SIZE_OPTIONS.map(option => (
              <Chip
                key={option.id}
                active={prefs.size === option.id}
                onClick={() => onChange({ ...prefs, size: option.id })}
              >
                {option.label(surfaceMax)}
              </Chip>
            ))}
          </div>
        </div>
        <div className="space-y-1">
          <p className="text-chip text-white/50">Format</p>
          <div className="flex gap-2 overflow-x-auto scrollbar-hide">
            {FORMAT_OPTIONS.map(option => (
              <Chip
                key={option.id}
                active={prefs.format === option.id}
                onClick={() => onChange({ ...prefs, format: option.id })}
              >
                {option.label}
              </Chip>
            ))}
          </div>
        </div>
        <p className="text-chip text-white/40">
          Applies to photos when you tap Done. Remembered for next time.
        </p>
      </div>
    </div>
  );
}
