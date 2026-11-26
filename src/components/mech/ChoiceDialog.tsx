'use client';

import { useEffect, useRef } from 'react';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

/**
 * A choice dialog of the mechanical dialect (General post composer, Nov 26
 * 2026): a title, one soft line, and a STACK of keys — the main choice
 * filled, a destructive one outlined in the danger colour, the way back as
 * plain accent text. A real dialog: Escape takes the way back (`onDismiss`),
 * focus lands on the way back when it opens (the least destructive key).
 * Every key names what happens; the dialog never closes on a scrim tap.
 */
export interface ChoiceAction {
  label: string;
  tone: 'primary' | 'danger' | 'text';
  onClick: () => void;
  /** A stable hook for tests, e.g. "save-draft". */
  hook: string;
}

interface ChoiceDialogProps {
  isOpen: boolean;
  title: string;
  line?: string;
  actions: ChoiceAction[];
  /** Escape. Usually the `text` action's handler. */
  onDismiss: () => void;
  /** A stable hook on the dialog, e.g. "save-draft". */
  hook: string;
}

export default function ChoiceDialog({ isOpen, title, line, actions, onDismiss, hook }: ChoiceDialogProps) {
  useBodyScrollLock(isOpen);
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!isOpen) return;
    backRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onDismiss();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [isOpen, onDismiss]);

  if (!isOpen) return null;
  const lastText = actions.map(a => a.tone).lastIndexOf('text');

  return (
    <div className="ea-mech ea-mech-overlay fixed inset-0 z-[60] flex items-center justify-center p-4" data-mech-dialog={hook}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`choice-${hook}-title`}
        className="flex max-h-modal w-full min-w-0 max-w-[326px] flex-col overflow-y-auto rounded-[20px] p-5"
        style={{ backgroundColor: 'var(--mech-panel)', border: '1px solid var(--mech-outline-off)', boxShadow: 'var(--mech-dialog-depth)' }}
      >
        <h2 id={`choice-${hook}-title`} className="text-lg font-bold text-[color:var(--mech-text)]">{title}</h2>
        {line && <p className="mt-1.5 text-[13px] leading-5 text-[color:var(--mech-text-soft)]">{line}</p>}
        <div className="mt-4 flex flex-col gap-2">
          {actions.map((action, index) => {
            if (action.tone === 'primary') {
              return (
                <button key={action.hook} type="button" onClick={action.onClick} data-mech-choice={action.hook} className="ea-mech-next inline-flex h-12 w-full items-center justify-center rounded-[14px] px-4 text-[15px] font-semibold">
                  {action.label}
                </button>
              );
            }
            if (action.tone === 'danger') {
              return (
                <button key={action.hook} type="button" onClick={action.onClick} data-mech-choice={action.hook} data-tone="danger" className="ea-mech-outline-key inline-flex h-12 w-full items-center justify-center rounded-[14px] px-4 text-[15px] font-semibold">
                  {action.label}
                </button>
              );
            }
            return (
              <button
                key={action.hook}
                ref={index === lastText ? backRef : undefined}
                type="button"
                onClick={action.onClick}
                data-mech-choice={action.hook}
                className="ea-mech-btn inline-flex h-11 w-full items-center justify-center rounded-[14px] px-4 text-[15px] font-semibold text-[color:var(--mech-accent-light)]"
              >
                {action.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
