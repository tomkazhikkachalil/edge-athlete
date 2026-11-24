'use client';

import type { ReactNode } from 'react';

/**
 * A key switch (the mechanical dialect, Nov 23 2026): a recessed track
 * holding two or more keys; the pressed key is raised. Each key is a real
 * button with `aria-pressed`, so a switch reads and tests like the pair of
 * toggle buttons it replaces. It owns no data: the caller holds the value.
 *
 *  - `size="lg"`: the round-type keys — equal columns, 56 px, the selected
 *    key also wears the selected border (`ring`).
 *  - `size="sm"`: the compact keys of a switch row — 44 px, fixed widths
 *    from the caller (`keyClassName`), optional indicator light.
 */
export interface KeySwitchOption<T extends string> {
  value: T;
  label: string;
  /** Drawn before the label; receives whether this key is the pressed one. */
  icon?: (selected: boolean) => ReactNode;
}

interface KeySwitchProps<T extends string> {
  options: readonly KeySwitchOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** What the switch answers, for assistive tech (the visible label sits above it). */
  label: string;
  size?: 'lg' | 'sm';
  /** A 6 px light before each label, lit on the pressed key. */
  light?: boolean;
  /** Fixed-width numbers (the mono readout) for the key labels. */
  mono?: boolean;
  keyClassName?: string;
  className?: string;
  id?: string;
}

export default function KeySwitch<T extends string>({ options, value, onChange, label, size = 'lg', light = false, mono = false, keyClassName = '', className = '', id }: KeySwitchProps<T>) {
  const lg = size === 'lg';
  return (
    <div
      id={id}
      role="group"
      aria-label={label}
      className={`ea-mech-recess ${lg ? 'grid gap-1 p-1 rounded-[15px]' : 'inline-flex gap-0 p-[3px] rounded-xl'} ${className}`}
      style={lg ? { gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` } : undefined}
      data-key-switch=""
    >
      {options.map(option => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={selected}
            {...(lg ? { 'data-ring': '' } : {})}
            className={`ea-mech-key inline-flex items-center justify-center gap-2 min-w-0 ${
              lg ? 'h-14 rounded-[11px] px-1.5 text-[15px] font-semibold' : `h-11 rounded-[9px] text-[13px] ${mono ? 'ea-mech-readout !text-inherit' : 'font-semibold'}`
            } ${keyClassName}`}
          >
            {light && (
              <span
                aria-hidden="true"
                className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                style={selected
                  ? { backgroundColor: 'var(--mech-selected-border)', boxShadow: '0 0 6px var(--mech-selected-border)' }
                  : { backgroundColor: 'var(--mech-progress-empty)' }}
              />
            )}
            {option.icon?.(selected)}
            <span className="truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
