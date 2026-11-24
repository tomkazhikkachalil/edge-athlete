'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { getAllSports, type SportKey } from '@/lib/sports/SportRegistry';
import { enteringFavourites, partitionSports } from '@/lib/sports/favourite-sports';
import { useFavouriteSports } from '@/hooks/useFavouriteSports';
import { useLastSport } from '@/hooks/useLastSport';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import FaIcon from '@/components/FaIcon';
import { faMagnifyingGlass } from '@/lib/icons/fa/magnifying-glass';
import { faXmark } from '@/lib/icons/fa/xmark';
import { sportIcon } from '@/lib/sports/sport-icons';

/**
 * The composer's Sport step — search first, favourites per account (Tom's
 * spec, Oct 27 2026; migration 285). Top to bottom: the search, Favourites
 * (only once the account has one), All Sports alphabetical. No "General
 * Post" and nothing pre-selected: a new post already starts General (Oct 10
 * rule) and closing this without a pick leaves it so; a chosen sport is
 * cleared with the composer's "Remove sport" link, never from here.
 *
 * The look (Tom's visual spec, Nov 23 2026 — the mechanical dialect,
 * `.ea-mech`): a grid of small tiles, three across on a phone and five on a
 * desktop, so every sport fits one screen. One tile per sport: the icon top
 * left, the name bottom left, and the favourite SWITCH top right with its
 * OWN tap target (a sibling button, never nested) — favouriting never picks
 * the sport. A tile tap picks the sport and closes. The switch's accessible
 * name never carries the sport's name (`aria-describedby` points at it), so
 * "the one button named Golf" stays the tile — the e2e specs rely on that.
 * A favourite still appears under All Sports (Tom, Nov 23: unchanged).
 * LAST marks the sport of the account's newest sport post (useLastSport).
 */
interface SportSelectorProps {
  onSelectSport: (sportKey: SportKey) => void;
  onClose: () => void;
}

type PickerSport = ReturnType<typeof getAllSports>[number];

/** The section change waits for the switch to finish moving (spec: ~400 ms). */
const MOVE_DELAY_MS = 400;

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
  const lastSport = useLastSport();

  // The Favourites SECTION follows the stored list a beat late: the switch
  // flips at once (its own confirmation), then the tile arrives in — or
  // leaves — the section. `entering` names the tiles that slide in.
  const [shown, setShown] = useState<{ keys: string[]; entering: string[] }>({ keys: favourites, entering: [] });
  const favouritesKey = favourites.join(',');
  useEffect(() => {
    const next = favouritesKey ? favouritesKey.split(',') : [];
    const timer = window.setTimeout(() => {
      setShown(prev => (prev.keys.join(',') === favouritesKey ? prev : { keys: next, entering: enteringFavourites(prev.keys, next) }));
    }, MOVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [favouritesKey]);

  const sections = useMemo(
    () => partitionSports(getAllSports(), shown.keys, searchQuery),
    [shown.keys, searchQuery],
  );

  const handleSelectSport = (sport: PickerSport) => {
    if (!sport.enabled) return;
    onSelectSport(sport.sport_key);
    onClose();
  };

  const nothingFound = sections.favourites.length === 0 && sections.all.length === 0;

  return (
    <div className="ea-mech ea-mech-overlay fixed inset-0 flex items-stretch sm:items-center justify-center z-[60] sm:p-4">
      <div className="ea-mech-dialog w-full sm:max-w-[640px] sm:max-h-modal flex flex-col px-4 sm:p-5 pt-[calc(0.5rem+env(safe-area-inset-top))] pb-[env(safe-area-inset-bottom)]">
        {/* Top bar */}
        <div className="flex items-center justify-between min-h-[44px] shrink-0">
          <h3 className="ea-mech-title">Select Sport</h3>
          <button
            type="button"
            onClick={onClose}
            className="ea-mech-close inline-flex items-center justify-center"
            aria-label="Close"
          >
            <FaIcon icon={faXmark} />
          </button>
        </div>

        {/* Search slot */}
        <div className="ea-mech-recess mt-2.5 flex items-center gap-2.5 h-12 px-3.5 rounded-[14px] shrink-0">
          <FaIcon icon={faMagnifyingGlass} className="text-[18px] text-[color:var(--mech-label)]" />
          <input
            ref={searchRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search sports"
            aria-label="Search sports"
            // text-base: 16 px at EVERY width — iOS zooms into a focused field under 16 px.
            className="ea-mech-slot-input flex-1 min-w-0 h-full text-base"
            data-sport-search=""
          />
        </div>

        {/* Content - Scrollable */}
        <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1 pt-2.5 pb-4">
          {nothingFound ? (
            <p className="py-8 text-center text-sm text-[color:var(--mech-text-soft)]">No sports found</p>
          ) : (
            <>
              {sections.favourites.length > 0 && (
                <div className="mb-2.5" data-sport-favourites="">
                  <h4 className="ea-mech-micro mb-2">Favourites</h4>
                  <ul className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                    {sections.favourites.map(sport => (
                      <SportTile
                        key={`fav-${sport.sport_key}`}
                        section="fav"
                        sport={sport}
                        isFavourite={favourites.includes(sport.sport_key)}
                        canFavourite={canFavourite}
                        isLast={lastSport === sport.sport_key}
                        entering={shown.entering.includes(sport.sport_key)}
                        onSelect={handleSelectSport}
                        onToggleFavourite={toggle}
                      />
                    ))}
                  </ul>
                </div>
              )}

              {sections.all.length > 0 && (
                <div>
                  <h4 className="ea-mech-micro mb-2">All Sports</h4>
                  <ul className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                    {sections.all.map(sport => (
                      <SportTile
                        key={`all-${sport.sport_key}`}
                        section="all"
                        sport={sport}
                        isFavourite={favourites.includes(sport.sport_key)}
                        canFavourite={canFavourite}
                        isLast={lastSport === sport.sport_key}
                        entering={false}
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

interface SportTileProps {
  section: 'fav' | 'all';
  sport: PickerSport;
  isFavourite: boolean;
  canFavourite: boolean;
  isLast: boolean;
  entering: boolean;
  onSelect: (sport: PickerSport) => void;
  onToggleFavourite: (sportKey: string) => void;
}

/** One sport: a tile button (the pick) and a SIBLING switch (the favourite). */
function SportTile({ section, sport, isFavourite, canFavourite, isLast, entering, onSelect, onToggleFavourite }: SportTileProps) {
  const isDisabled = !sport.enabled;
  const nameId = `sport-name-${section}-${sport.sport_key}`;
  const [pressed, setPressed] = useState(false);
  const release = () => setPressed(false);

  return (
    <li
      data-sport-row={sport.sport_key}
      className="ea-mech-tile h-[76px] min-w-0"
      {...(pressed ? { 'data-pressed': '' } : {})}
      {...(isDisabled ? { 'data-off': '' } : {})}
      {...(entering ? { 'data-enter': '' } : {})}
    >
      <button
        type="button"
        onClick={() => onSelect(sport)}
        disabled={isDisabled}
        onPointerDown={() => setPressed(true)}
        onPointerUp={release}
        onPointerLeave={release}
        onPointerCancel={release}
        className={`absolute inset-0 w-full rounded-[14px] pt-[11px] pl-3 pr-2.5 pb-2.5 flex flex-col items-start justify-between text-left ${
          isDisabled ? 'cursor-not-allowed' : ''
        }`}
      >
        <FaIcon icon={sportIcon(sport.sport_key)} aria-hidden="true" className="ea-mech-icon text-[22px]" />
        <span id={nameId} className="block w-full truncate text-[13px] leading-[18px] font-semibold text-[color:var(--mech-text)]">
          {sport.display_name}
        </span>
      </button>
      {isDisabled ? (
        <span className="ea-mech-micro absolute top-[11px] right-2.5 !text-[9px] pointer-events-none">Soon</span>
      ) : canFavourite ? (
        <button
          type="button"
          onClick={() => onToggleFavourite(sport.sport_key)}
          className="absolute top-0 right-0 w-12 h-11 rounded-[14px] inline-flex items-start justify-end pt-[11px] pr-2.5"
          aria-pressed={isFavourite}
          aria-label={isFavourite ? 'Remove from favourites' : 'Add to favourites'}
          aria-describedby={nameId}
          data-sport-favourite={sport.sport_key}
        >
          <span className="ea-mech-fav-track" aria-hidden="true">
            <span className="ea-mech-fav-knob" />
          </span>
        </button>
      ) : null}
      {isLast && !isDisabled && (
        <span className="ea-mech-micro absolute bottom-2.5 right-2.5 !text-[9px] !text-[color:var(--mech-accent-light)] pointer-events-none" data-sport-last="">
          Last
        </span>
      )}
    </li>
  );
}
