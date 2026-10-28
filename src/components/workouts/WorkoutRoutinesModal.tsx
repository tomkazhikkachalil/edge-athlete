'use client';

import { X } from 'lucide-react';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import RoutineManager, { ROUTINES_HELP } from './RoutineManager';
import SectionInfo from '@/components/SectionInfo';

/**
 * Thin house-modal host for RoutineManager, opened from the Training
 * quick-settings modal. No dirty state of its own — the manager's editor
 * modal handles its own discard confirms.
 */

interface WorkoutRoutinesModalProps {
  onClose: () => void;
}

export default function WorkoutRoutinesModal({ onClose }: WorkoutRoutinesModalProps) {
  useBodyScrollLock(true);

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-surface-raised rounded-xl shadow-xl max-w-lg w-full max-h-modal flex flex-col">
        <SectionInfo
          heading="Workout routines"
          headingClassName="text-lg font-bold text-primary"
          className="shrink-0 px-4 sm:px-6 py-4 border-b border-border"
          trailing={
            <button
              onClick={onClose}
              aria-label="Close"
              className="ea-icon-btn inline-flex items-center justify-center"
            >
              <X className="w-5 h-5 text-muted" />
            </button>
          }
        >
          <p>{ROUTINES_HELP}</p>
        </SectionInfo>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-4">
          <RoutineManager />
        </div>
      </div>
    </div>
  );
}
