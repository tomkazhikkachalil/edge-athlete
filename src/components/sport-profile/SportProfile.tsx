'use client';

/**
 * The athlete's sport profile (Sprint 4, docs/specs/sport-profile.md): one
 * sport at a time — pick it at the top and the whole page is that sport —
 * then Career → Season. The level is the address (view.ts), each step down
 * a history entry, so Back walks up. ONE component for both routes
 * (/athlete/[id]/sport/[sport] and /u/[username]/sport/[sport]).
 */
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import FaIcon from '@/components/FaIcon';
import { AvatarImage } from '@/components/OptimizedImage';
import { getSportDefinition, type SportKey } from '@/lib/sports/SportRegistry';
import { sportIcon } from '@/lib/sports/sport-icons';
import { gameSheetFor, sheetEvent } from '@/lib/videos/game-sheets';
import type { SportSkillCard } from '@/lib/sports/server/types';
import { parseSportView, sportViewLevel, switcherSports } from '@/lib/sport-profile/view';
import type { SportProfileAnswer, SportProfileData } from './types';

function LevelLoading() {
  return <div className="min-h-[40vh] w-full" aria-busy="true" data-sport-level-loading="" />;
}
const CareerView = dynamic(() => import('./CareerView'), { ssr: false, loading: LevelLoading });
const SeasonView = dynamic(() => import('./SeasonView'), { ssr: false, loading: LevelLoading });
const GameView = dynamic(() => import('./GameView'), { ssr: false, loading: LevelLoading });
const StatReel = dynamic(() => import('./StatReel'), { ssr: false, loading: LevelLoading });

export interface SportProfileProps {
  profileId: string;
  name: string;
  avatarUrl: string | null;
  /** The athlete's sports, already in their own order (pins, then the primary). */
  cards: SportSkillCard[];
  sport: string;
  /** The athlete's main profile, and the address of one sport's profile. */
  profilePath: string;
  sportPath: (sportKey: string) => string;
}

type Load = { state: 'loading' } | { state: 'error' } | { state: 'ready'; answer: SportProfileAnswer };

export default function SportProfile({ profileId, name, avatarUrl, cards, sport, profilePath, sportPath }: SportProfileProps) {
  const view = parseSportView(useSearchParams());
  const level = sportViewLevel(view);
  const sports = switcherSports(cards);
  const card = cards.find(c => c.sportKey === sport) ?? null;
  const label = card?.sportLabel ?? getSportDefinition(sport as SportKey)?.display_name ?? 'Sport';
  // The viewer's own choice to open spoiler-free games — asked for, never the default.
  const [showHeld, setShowHeld] = useState(false);
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [asked, setAsked] = useState({ profileId, sport, showHeld });
  if (asked.profileId !== profileId || asked.sport !== sport || asked.showHeld !== showHeld) {
    // A new sport is a new page of numbers; the same sport with the spoilers opened keeps what is on screen until the answer lands.
    if (asked.profileId !== profileId || asked.sport !== sport) setLoad({ state: 'loading' });
    setAsked({ profileId, sport, showHeld });
  }

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/profile/${profileId}/sport-profile?sport=${encodeURIComponent(sport)}${showHeld ? '&spoilers=show' : ''}`, { credentials: 'include' })
      .then(async r => {
        if (!r.ok) throw new Error(String(r.status));
        return (await r.json()) as SportProfileAnswer;
      })
      .then(answer => { if (!cancelled) setLoad({ state: 'ready', answer }); })
      .catch(() => { if (!cancelled) setLoad({ state: 'error' }); });
    return () => { cancelled = true; };
  }, [profileId, sport, showHeld]);

  const basePath = sportPath(sport);
  // A clip says what it is in the sheet's own words ("Goal", "Three-pointer made").
  const eventLabel = useCallback((eventKey: string | null): string | null => {
    const sheet = gameSheetFor(sport);
    return sheet ? sheetEvent(sheet, eventKey)?.label ?? null : null;
  }, [sport]);
  const data: SportProfileData | null = load.state === 'ready' && load.answer.supported ? load.answer : null;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6" data-sport-profile={sport}>
      <header className="mb-6 space-y-4">
        <Link href={profilePath} className="ea-interactive inline-flex items-center gap-3 rounded-lg" data-sport-profile-owner="">
          <AvatarImage src={avatarUrl} alt="" size={44} fallbackInitials={name.slice(0, 1).toUpperCase()} />
          <span>
            <span className="block text-lg font-bold text-primary">{name}</span>
            <span className="block text-sm text-secondary">{label} profile</span>
          </span>
        </Link>

        {sports.length > 1 && (
          <nav aria-label="Sport" className="-mx-4 flex gap-2 overflow-x-auto px-4 scrollbar-hide sm:mx-0 sm:px-0" data-sport-switcher="">
            {sports.map(c => {
              const active = c.sportKey === sport;
              return (
                <Link
                  key={c.sportKey}
                  href={sportPath(c.sportKey)}
                  aria-current={active ? 'page' : undefined}
                  data-sport-chip={c.sportKey}
                  className={`ea-interactive inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-medium ${active ? 'border-brand bg-brand text-white' : 'border-border bg-surface text-primary'}`}
                >
                  <FaIcon icon={sportIcon(c.sportKey)} className="h-4 w-4" />
                  {c.sportLabel}
                </Link>
              );
            })}
          </nav>
        )}

        {card && card.entered.length > 0 && (
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm" data-sport-profile-facts="">
            {card.entered.slice(0, 4).map(item => (
              <div key={item.key} className="flex gap-2">
                <dt className="text-muted">{item.label}</dt>
                <dd className="font-medium text-primary">{item.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </header>

      <main className="rounded-xl border border-border bg-surface p-4 shadow-sm sm:p-6">
        {load.state === 'loading' && <LevelLoading />}
        {load.state === 'error' && (
          <p className="text-secondary" role="alert">This sport profile could not be loaded. <Link href={profilePath} className="underline decoration-border underline-offset-4">Back to the profile</Link></p>
        )}
        {load.state === 'ready' && !load.answer.supported && (
          <p className="text-secondary" data-sport-unsupported="">
            {label} keeps its numbers on the Stats tab. <Link href={`${profilePath}?tab=stats&sport=${encodeURIComponent(sport)}`} className="underline decoration-border underline-offset-4">Open {label} stats</Link>
          </p>
        )}
        {/* A number's clips, at the career or a season: the reel sits above the level it was opened from. */}
        {data && level !== 'game' && view.stat && (
          <StatReel data={data} profileId={profileId} season={view.season} stat={view.stat} basePath={basePath} showHeld={showHeld} eventLabel={eventLabel} />
        )}
        {data && level === 'career' && <CareerView data={data} basePath={basePath} sportLabel={label} />}
        {data && level === 'season' && view.season && (
          <SeasonView data={data} season={view.season} basePath={basePath} sportLabel={label} onShowHeld={() => setShowHeld(true)} />
        )}
        {data && level === 'game' && view.game && (
          <GameView data={data} profileId={profileId} season={view.season} gameKey={view.game} stat={view.stat} basePath={basePath} sportLabel={label} showHeld={showHeld} onShowHeld={() => setShowHeld(true)} eventLabel={eventLabel} />
        )}
      </main>
    </div>
  );
}
