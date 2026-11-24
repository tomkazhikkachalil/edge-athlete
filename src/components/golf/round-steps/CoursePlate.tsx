'use client';

import { useState } from 'react';
import FaIcon from '@/components/FaIcon';
import { faGolfBallTee } from '@/lib/icons/fa/golf-ball-tee';
import { logoUrl } from '@/lib/logo-dev';

/**
 * The course plate (the mechanical dialect, Nov 23 2026): the picked course
 * at the top of the course step — the club's logo in a 44 px ring, the
 * name on one line, the place under it, and "Change", which returns to the
 * search. The logo is the club's real one (Logo.dev by the course's own
 * website); with no token, no website or a failed load it is the golf glyph
 * — never a broken image. `data-course-chosen` is the hook the specs read.
 */
interface CoursePlateProps {
  name: string;
  /** City / region, or what the course is ("Custom course"). */
  place?: string | null;
  /** The course website's bare domain (websiteDomain) — the logo's key. */
  logoDomain?: string | null;
  onChange: () => void;
}

export default function CoursePlate({ name, place, logoDomain, onChange }: CoursePlateProps) {
  const src = logoUrl(logoDomain ?? undefined, 44);
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const showLogo = !!src && failedFor !== src;

  return (
    <div className="ea-mech-panel flex items-center gap-3 h-16 rounded-2xl pl-3 pr-1" data-course-chosen="" data-course-logo={showLogo ? 'logo' : 'glyph'}>
      <span
        aria-hidden="true"
        className="relative inline-flex items-center justify-center w-11 h-11 shrink-0 rounded-full overflow-hidden"
        style={{
          backgroundColor: 'var(--mech-tile)',
          border: '1px solid var(--mech-outline)',
          boxShadow: 'inset 0 0 0 3px var(--mech-surface), inset 0 0 0 4px var(--mech-hairline)',
        }}
      >
        {showLogo ? (
          // A plain <img>, like BrandLogo: a 404 upstream must be a clean onError.
          // eslint-disable-next-line @next/next/no-img-element -- Logo.dev image; the optimizer would turn a miss into an error from our own origin
          <img src={src!} alt="" width={44} height={44} loading="lazy" className="w-full h-full object-cover" onError={() => setFailedFor(src)} />
        ) : (
          <FaIcon icon={faGolfBallTee} className="ea-mech-icon text-[18px]" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-[color:var(--mech-text)]" data-course-chosen-name="">{name}</span>
        {place && <span className="block truncate text-xs text-[color:var(--mech-text-soft)]">{place}</span>}
      </span>
      <button
        type="button"
        onClick={onChange}
        data-course-change=""
        aria-label="Change course"
        className="ea-mech-btn inline-flex items-center min-h-[44px] rounded-lg px-3 text-[13px] font-semibold text-[color:var(--mech-accent-light)]"
      >
        Change
      </button>
    </div>
  );
}
