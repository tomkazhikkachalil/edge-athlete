'use client';

import { useState } from 'react';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

// The classic recurring-event question ("This event only / This and
// following / The entire series"). ConfirmModal is binary — this is its
// radio-list sibling, reused for edit, cancel, and respond flows.

export interface ScopeOption<T extends string = string> {
  value: T;
  label: string;
  description?: string;
}

export default function ScopeChooserModal<T extends string>({
  isOpen,
  title,
  message,
  options,
  defaultValue,
  confirmText,
  destructive = false,
  onConfirm,
  onCancel,
}: {
  isOpen: boolean;
  title: string;
  message?: string;
  options: ScopeOption<T>[];
  defaultValue: T;
  confirmText: string;
  destructive?: boolean;
  onConfirm: (value: T) => void;
  onCancel: () => void;
}) {
  const [selected, setSelected] = useState<T>(defaultValue);
  useBodyScrollLock(isOpen);
  // Reset the selection when the modal opens — synchronisation, render phase.
  const [synced, setSynced] = useState({ isOpen, defaultValue });
  if (synced.isOpen !== isOpen || synced.defaultValue !== defaultValue) {
    setSynced({ isOpen, defaultValue });
    if (isOpen) setSelected(defaultValue);
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4">
      <div className="bg-surface-raised rounded-lg shadow-xl max-w-sm w-full p-6">
        <h3 className="text-base font-bold text-primary mb-1">{title}</h3>
        {message && <p className="text-sm text-tertiary mb-3">{message}</p>}
        <div className="space-y-1 mb-5 mt-3">
          {options.map(opt => (
            <label
              key={opt.value}
              className={`flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer transition ${
                selected === opt.value
                  ? 'border-brand bg-brand-soft'
                  : 'border-border hover:border-violet-300 dark:hover:border-violet-700'
              }`}
            >
              <input
                type="radio"
                name="scope"
                checked={selected === opt.value}
                onChange={() => setSelected(opt.value)}
                className="mt-0.5 accent-violet-600"
              />
              <span className="text-sm">
                <span className="text-primary font-medium">{opt.label}</span>
                {opt.description && <span className="block text-muted text-xs">{opt.description}</span>}
              </span>
            </label>
          ))}
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => onConfirm(selected)}
            className={`flex-1 py-2.5 rounded-lg text-sm font-medium text-white transition min-h-[44px] ${
              destructive ? 'bg-red-600 hover:bg-red-700' : 'bg-brand hover:bg-brand-hover'
            }`}
          >
            {confirmText}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-lg text-sm font-medium border border-border-strong text-secondary hover:bg-surface-muted transition min-h-[44px]"
          >
            Go back
          </button>
        </div>
      </div>
    </div>
  );
}
