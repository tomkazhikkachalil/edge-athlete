'use client';

/**
 * One picked file in the guardian batch upload (Wave 5): thumbnail, which
 * athletes it goes to (44px toggle pills — thumb-sized, wrapping at 375px),
 * and per-athlete event suggestions. A suggestion is ALWAYS a chip the
 * guardian answers — Attach or No thanks — never a silent assignment
 * (event-autotag.ts carries the reliability caveats).
 */

export interface BatchAthleteOption {
  id: string;
  name: string;
  selectable: boolean;
  /** Honest copy for a pill that can't be selected (consent gap etc.). */
  blockedReason?: string;
}

export interface ItemEventSuggestion {
  athleteId: string;
  athleteName: string;
  eventId: string;
  title: string;
  decision: 'pending' | 'attached' | 'declined';
}

interface BatchUploadItemCardProps {
  itemId: string;
  previewUrl: string;
  kind: 'image' | 'video';
  athletes: BatchAthleteOption[];
  assigned: string[];
  suggestions: ItemEventSuggestion[];
  disabled?: boolean;
  onToggleAthlete: (athleteId: string) => void;
  onSuggestionDecision: (athleteId: string, decision: 'attached' | 'declined') => void;
  onRemove: () => void;
}

export default function BatchUploadItemCard({
  itemId,
  previewUrl,
  kind,
  athletes,
  assigned,
  suggestions,
  disabled = false,
  onToggleAthlete,
  onSuggestionDecision,
  onRemove,
}: BatchUploadItemCardProps) {
  return (
    <div className="bg-surface border border-border rounded-lg p-3 flex gap-3">
      {/* Thumbnail — objectURL of the edited render, owned by the page. */}
      <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg bg-surface-sunken">
        {kind === 'video' ? (
          <video src={previewUrl} muted playsInline className="h-full w-full object-cover" />
        ) : (
          // objectURL blob — next/image can't optimize it; plain img is the
          // established pattern for editor previews (image_optimization_policy).
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="" className="h-full w-full object-cover" />
        )}
        {kind === 'video' && (
          <span className="absolute bottom-1 right-1 text-white text-[10px] bg-black/60 rounded px-1">
            <i className="fas fa-video" aria-hidden="true"></i>
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-semibold text-tertiary uppercase tracking-wide pt-1">
            Post to
          </p>
          <button
            type="button"
            onClick={onRemove}
            disabled={disabled}
            title="Remove from batch"
            aria-label="Remove from batch"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-faint hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50"
          >
            <i className="fas fa-trash text-xs" aria-hidden="true"></i>
          </button>
        </div>

        {/* Athlete pills — wrap freely at 375px, each a real 44px target. */}
        <div className="mt-1 flex flex-wrap gap-2">
          {athletes.map(a => {
            const on = assigned.includes(a.id);
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => a.selectable && onToggleAthlete(a.id)}
                disabled={disabled || !a.selectable}
                aria-pressed={on}
                title={a.selectable ? undefined : a.blockedReason}
                className={`min-h-[44px] px-3 rounded-full border text-sm font-semibold transition-colors disabled:opacity-50 ${
                  on
                    ? 'bg-brand text-white border-brand'
                    : 'border-border-strong text-secondary hover:bg-surface-muted'
                }`}
              >
                {on && <i className="fas fa-check text-xs mr-1.5" aria-hidden="true"></i>}
                {a.name}
              </button>
            );
          })}
        </div>

        {/* Event suggestions — one chip line per assigned athlete with a
            match. Own wrapping lines (375px chip rule). */}
        {suggestions.map(s => (
          <div
            key={`${itemId}-${s.athleteId}`}
            className="mt-2 flex flex-wrap items-center gap-2 text-sm"
          >
            {s.decision === 'attached' ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-100 dark:bg-violet-950/60 px-3 py-1.5 text-brand-fg-strong font-medium">
                <i className="fas fa-calendar-check text-xs" aria-hidden="true"></i>
                <span className="min-w-0 truncate max-w-[14rem]">{s.title}</span>
                <button
                  type="button"
                  onClick={() => onSuggestionDecision(s.athleteId, 'declined')}
                  disabled={disabled}
                  aria-label={`Detach ${s.title}`}
                  className="ml-1 text-brand-fg hover:text-brand-fg-strong"
                >
                  <i className="fas fa-times text-xs" aria-hidden="true"></i>
                </button>
              </span>
            ) : s.decision === 'declined' ? (
              <span className="text-xs text-muted">Not attached to an event.</span>
            ) : (
              <>
                <span className="min-w-0 text-secondary">
                  Looks like <span className="font-semibold">{s.title}</span>
                  {athletes.length > 1 ? ` (${s.athleteName})` : ''} — attach?
                </span>
                <span className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onSuggestionDecision(s.athleteId, 'attached')}
                    disabled={disabled}
                    className="min-h-[36px] px-3 rounded-lg bg-brand hover:bg-brand-hover text-white text-xs font-bold transition-colors disabled:opacity-50"
                  >
                    Attach
                  </button>
                  <button
                    type="button"
                    onClick={() => onSuggestionDecision(s.athleteId, 'declined')}
                    disabled={disabled}
                    className="min-h-[36px] px-3 rounded-lg border border-border-strong text-secondary text-xs font-semibold hover:bg-surface-muted transition-colors disabled:opacity-50"
                  >
                    No thanks
                  </button>
                </span>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
