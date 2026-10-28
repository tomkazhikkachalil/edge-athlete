'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { getAllSports, type SportKey } from '@/lib/sports/SportRegistry';
import { partitionSports } from '@/lib/sports/favourite-sports';
import { useFavouriteSports } from '@/hooks/useFavouriteSports';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

/**
 * The composer's Sport step — search first, favourites per account (Tom's
 * spec, Oct 27 2026; migration 285). Top to bottom: the search, Favourites
 * (only once the account has one), All Sports alphabetical. No "General
 * Post" and nothing pre-selected: a new post already starts General (Oct 10
 * rule) and closing this without a pick leaves it so; a chosen sport is
 * cleared with the composer's "Remove sport" link, never from here.
 *
 * One row per sport: the icon, the name, a star on the far right with its
 * OWN tap target (a sibling button, never nested) — favouriting never picks
 * the sport. A row tap picks the sport and closes. The star's accessible
 * name never carries the sport's name (`aria-describedby` points at it), so
 * "the one button named Golf" stays the row — the e2e specs rely on that.
 */
interface SportSelectorProps {
  onSelectSport: (sportKey: SportKey) => void;
  onClose: () => void;
}

type PickerSport = ReturnType<typeof getAllSports>[number];

export default function SportSelector({ onSelectSport, onClose }: SportSelectorProps) {
  // Mounted only while open — lock background scroll for the whole lifetime
  useBodyScrollLock();

  const [searchQuery, setSearchQuery] = useState('');

  // Focus the search only where a keyboard is already there (a fine pointer).
  // Tom (Oct 22 2026, iPhone): after a cold open, Create → Sport zoomed the
  // screen to the far left — this picker mounts inside the composer's lazy
  // chunk, so on the first open its mount (and a bare `autoFocus`) lands
  // AFTER the tap, outside the gesture, and iOS reveals the field by zooming
  // to it. A phone opens the picker with the sport list in view and no
  // keyboard (the list is the point; search is optional); the desktop keeps
  // typing straight away. Never fixed by disabling page zoom.
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    searchRef.current?.focus({ preventScroll: true });
  }, []);

  const { favourites, canFavourite, toggle } = useFavouriteSports();
  const sections = useMemo(
    () => partitionSports(getAllSports(), favourites, searchQuery),
    [favourites, searchQuery],
  );

  const handleSelectSport = (sport: PickerSport) => {
    if (!sport.enabled) return;
    onSelectSport(sport.sport_key);
    onClose();
  };

  const nothingFound = sections.favourites.length === 0 && sections.all.length === 0;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
      <div className="bg-surface-raised rounded-lg shadow-xl max-w-2xl w-full max-h-modal flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="text-lg font-bold text-primary">Select Sport</h3>
          <button
            onClick={onClose}
            className="ea-icon-btn inline-flex items-center justify-center"
            aria-label="Close"
          >
            <i className="fas fa-times text-muted"></i>
          </button>
        </div>

        {/* Search Bar */}
        <div className="p-4 border-b border-border">
          <div className="relative">
            <i className="fas fa-search absolute left-3 top-1/2 transform -translate-y-1/2 text-decor"></i>
            <input
              ref={searchRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search sports..."
              // text-base: 16 px at EVERY width — iOS zooms into a focused field under 16 px.
              className="w-full pl-10 pr-4 py-2 text-base border border-border-strong rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
              data-sport-search=""
            />
          </div>
        </div>

        {/* Content - Scrollable */}
        <div className="flex-1 overflow-y-auto p-4">
          {nothingFound ? (
            <div className="text-center py-8 text-muted">
              <i className="fas fa-search text-3xl mb-2"></i>
              <p>No sports found</p>
            </div>
          ) : (
            <>
              {sections.favourites.length > 0 && (
                <div className="mb-6" data-sport-favourites="">
                  <h4 className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">
                    <i className="fas fa-star text-star mr-1" aria-hidden="true"></i>
                    Favourites
                  </h4>
                  <ul className="space-y-2">
                    {sections.favourites.map(sport => (
                      <SportRow
                        key={`fav-${sport.sport_key}`}
                        section="fav"
                        sport={sport}
                        isFavourite
                        canFavourite={canFavourite}
                        onSelect={handleSelectSport}
                        onToggleFavourite={toggle}
                      />
                    ))}
                  </ul>
                </div>
              )}

              {sections.all.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">
                    All Sports
                  </h4>
                  <ul className="space-y-2">
                    {sections.all.map(sport => (
                      <SportRow
                        key={`all-${sport.sport_key}`}
                        section="all"
                        sport={sport}
                        isFavourite={favourites.includes(sport.sport_key)}
                        canFavourite={canFavourite}
                        onSelect={handleSelectSport}
                        onToggleFavourite={toggle}
                      />
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

interface SportRowProps {
  section: 'fav' | 'all';
  sport: PickerSport;
  isFavourite: boolean;
  canFavourite: boolean;
  onSelect: (sport: PickerSport) => void;
  onToggleFavourite: (sportKey: string) => void;
}

/** One sport: a row button (the pick) and a SIBLING star button (the favourite). */
function SportRow({ section, sport, isFavourite, canFavourite, onSelect, onToggleFavourite }: SportRowProps) {
  const isDisabled = !sport.enabled;
  const nameId = `sport-name-${section}-${sport.sport_key}`;

  return (
    <li
      data-sport-row={sport.sport_key}
      className={`flex items-center gap-1 pr-1 border-2 rounded-lg transition-colors ${
        isDisabled
          ? 'border-border bg-surface-muted opacity-60'
          : 'border-border hover:border-border-strong hover:bg-surface-muted'
      }`}
    >
      <button
        type="button"
        onClick={() => onSelect(sport)}
        disabled={isDisabled}
        className={`ea-interactive flex-1 min-w-0 flex items-center gap-3 p-3 text-left rounded-lg ${
          isDisabled ? 'cursor-not-allowed' : ''
        }`}
      >
        <span
          aria-hidden="true"
          className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
            isDisabled ? 'bg-gray-200 dark:bg-stone-800 text-faint' : 'bg-surface-sunken text-tertiary'
          }`}
        >
          <i className={sport.icon_id}></i>
        </span>
        <span id={nameId} className={`font-semibold truncate ${isDisabled ? 'text-faint' : 'text-primary'}`}>
          {sport.display_name}
        </span>
        {isDisabled && (
          <>
            <span className="text-xs text-faint ml-1">Coming soon</span>
            <i className="fas fa-lock text-faint text-sm ml-auto" aria-hidden="true"></i>
          </>
        )}
      </button>
      {!isDisabled && canFavourite ? (
        <button
          type="button"
          onClick={() => onToggleFavourite(sport.sport_key)}
          className="ea-icon-btn inline-flex items-center justify-center shrink-0"
          aria-pressed={isFavourite}
          aria-label={isFavourite ? 'Remove from favourites' : 'Add to favourites'}
          aria-describedby={nameId}
          data-sport-favourite={sport.sport_key}
        >
          <i className={isFavourite ? 'fas fa-star text-star' : 'far fa-star text-muted'} aria-hidden="true"></i>
        </button>
      ) : (
        <span className="w-10 h-10 shrink-0" aria-hidden="true" />
      )}
    </li>
  );
}
