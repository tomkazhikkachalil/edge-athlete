'use client';

/**
 * The info button of the mechanical dialect (Nov 23 2026): a 44 px tap
 * area, a 28 px circle inside, an 18 px circled "i". Closed: the label
 * colour, no fill. Open: the accent fill, a white icon. It only reports the
 * tap; the caller swaps what it explains (`aria-controls` names it).
 */
interface InfoToggleProps {
  open: boolean;
  onToggle: () => void;
  /** e.g. "About when the round is" — the button's accessible name. */
  label: string;
  controls?: string;
  className?: string;
}

export default function InfoToggle({ open, onToggle, label, controls, className = '' }: InfoToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controls}
      aria-label={label}
      data-mech-info={open ? 'open' : 'closed'}
      className={`ea-mech-btn inline-flex items-center justify-center w-11 h-11 shrink-0 rounded-full ${className}`}
    >
      <span
        aria-hidden="true"
        className="inline-flex items-center justify-center w-7 h-7 rounded-full transition-colors"
        style={open
          ? { backgroundColor: 'var(--mech-accent)', color: '#ffffff' }
          : { color: 'var(--mech-label)' }}
      >
        {/* An 18 px circled "i" in the line style (stroke 1.8). */}
        <svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" focusable="false">
          <circle cx="9" cy="9" r="7.1" />
          <path d="M9 8.4v4.1" />
          <path d="M9 5.6v.1" />
        </svg>
      </span>
    </button>
  );
}
