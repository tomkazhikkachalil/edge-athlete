'use client';

import { useEffect, useMemo, useState, type ComponentType } from 'react';
import {
  BadgeCheck,
  Bird,
  CircleDot,
  Crown,
  Feather,
  Flag,
  Flame,
  Layers,
  Lock,
  Medal,
  Shuffle,
  Star,
  Target,
  TrendingDown,
  Trophy,
} from 'lucide-react';
import LargerWindow from '@/components/bubbles/LargerWindow';
import { SPORT_NAMES } from '@/lib/config/sports-config';
import { formatDateOnly } from '@/lib/sport-events/format';
import type { BadgeDef, BadgeIcon, BadgeTier } from '@/lib/play/badges/catalog';
import { badgeShelves, badgeViews, earnedLine, type BadgeView, type EarnedBadge } from '@/lib/play/badges/display';

/**
 * The badges an athlete has EARNED — the Play program (244). Automatic,
 * from real results in every sport (the catalog is src/lib/play/badges/);
 * distinct from the hand-entered achievements below it.
 *
 *  • `full` — the Achievements tab (/athlete, /athlete/[id]): shelves per
 *    sport; the owner also sees "Up next" (dimmed, locked) so there is
 *    always something to chase.
 *  • `compact` — the public /u/ overview: the best eight as chips and a
 *    "See all" window (the /u page has no achievements tab, and a signed-
 *    out visitor must not be sent to /athlete). Renders nothing at zero.
 *
 * Every badge opens its detail in the house LargerWindow (a bottom sheet
 * on a phone).
 */

const ICONS: Record<BadgeIcon, ComponentType<{ className?: string; 'aria-hidden'?: boolean }>> = {
  flag: Flag,
  layers: Layers,
  trophy: Trophy,
  verified: BadgeCheck,
  star: Star,
  golf: CircleDot,
  flame: Flame,
  bird: Bird,
  feather: Feather,
  target: Target,
  trending: TrendingDown,
  crown: Crown,
  shuffle: Shuffle,
  medal: Medal,
};

// A badge's tier wears its metal; a LOCKED one is an outline (never mistaken
// for silver). Literal classes — the JIT purges interpolated ones.
const TIER_LOOK: Record<BadgeTier, { circle: string; icon: string; chip: string }> = {
  gold: { circle: 'bg-amber-100 dark:bg-amber-950/60 ring-2 ring-amber-300 dark:ring-amber-700', icon: 'text-amber-600 dark:text-amber-300', chip: 'bg-amber-100 dark:bg-amber-950/60 text-amber-900 dark:text-amber-100' },
  silver: { circle: 'bg-slate-100 dark:bg-slate-800 ring-2 ring-slate-300 dark:ring-slate-600', icon: 'text-slate-600 dark:text-slate-200', chip: 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100' },
  bronze: { circle: 'bg-orange-50 dark:bg-orange-950/50 ring-2 ring-orange-200 dark:ring-orange-800', icon: 'text-orange-700 dark:text-orange-300', chip: 'bg-orange-50 dark:bg-orange-950/50 text-orange-900 dark:text-orange-100' },
};
const LOCKED_LOOK = { circle: 'border-2 border-dashed border-border', icon: 'text-faint' };

const sportName = (key: string | null) => (key === null ? 'Across sports' : SPORT_NAMES[key] ?? key);

interface EarnedBadgesProps {
  profileId: string;
  isOwnProfile?: boolean;
  variant?: 'full' | 'compact';
}

export default function EarnedBadges({ profileId, isOwnProfile = false, variant = 'full' }: EarnedBadgesProps) {
  const [earned, setEarned] = useState<EarnedBadge[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<BadgeView | BadgeDef | null>(null);
  const [allOpen, setAllOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/profile/${profileId}/badges`, { credentials: 'include' });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { badges?: EarnedBadge[] };
        if (!cancelled) setEarned(body.badges ?? []);
      } catch (e) {
        console.error('Failed to load badges:', e);
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  const shelves = useMemo(() => badgeShelves(earned ?? [], { withNext: isOwnProfile && variant === 'full' }), [earned, isOwnProfile, variant]);
  const views = useMemo(() => badgeViews(earned ?? []), [earned]);

  if (failed || earned === null) {
    // Loading or failed: the trophy case below still renders; badges are a garnish, never a blocker.
    return variant === 'full' && earned === null && !failed ? <div className="h-24 rounded-lg bg-surface-sunken animate-pulse" aria-hidden /> : null;
  }

  const detail = open ? (
    <BadgeDetail item={open} onClose={() => setOpen(null)} />
  ) : null;

  if (variant === 'compact') {
    if (views.length === 0) return null;
    return (
      <section className="mt-4 bg-surface rounded-xl shadow-sm border border-border p-4" aria-label="Badges" data-badges="compact">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-secondary">Badges · {views.length}</h2>
          {views.length > 8 && (
            <button type="button" onClick={() => setAllOpen(true)} className="text-sm font-semibold text-brand hover:underline">
              See all
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2" role="list">
          {views.slice(0, 8).map(v => (
            <BadgeChip key={v.key} view={v} onOpen={() => setOpen(v)} />
          ))}
        </div>
        {allOpen && (
          <LargerWindow title="Badges" subtitle={`${views.length} earned`} onClose={() => setAllOpen(false)} windowKey="badges">
            <Shelves shelves={badgeShelves(earned)} onOpen={setOpen} />
          </LargerWindow>
        )}
        {detail}
      </section>
    );
  }

  return (
    <section aria-labelledby="badges-heading" data-badges="full">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h3 id="badges-heading" className="text-h3 text-primary">Badges</h3>
        {views.length > 0 && <span className="text-sm text-muted">{views.length} earned</span>}
      </div>
      {views.length === 0 ? (
        isOwnProfile ? (
          <p className="text-sm text-muted border border-dashed border-border rounded-lg px-4 py-5 text-center">
            Badges are earned automatically from your results — log a round or a game to earn your first.
          </p>
        ) : null
      ) : (
        <Shelves shelves={shelves} onOpen={setOpen} />
      )}
      {detail}
    </section>
  );
}

function Shelves({ shelves, onOpen }: { shelves: ReturnType<typeof badgeShelves>; onOpen: (item: BadgeView | BadgeDef) => void }) {
  return (
    <div className="space-y-5">
      {shelves.map(shelf => (
        <div key={shelf.sportKey ?? 'all'}>
          <h4 className="text-label font-semibold text-secondary mb-2">{sportName(shelf.sportKey)}</h4>
          <ul className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            {shelf.badges.map(v => (
              <li key={v.key}>
                <BadgeTile def={v.def} verified={v.verified} sub={formatDateOnly(v.earnedOn)} onOpen={() => onOpen(v)} />
              </li>
            ))}
            {shelf.next.map(def => (
              <li key={def.key}>
                <BadgeTile def={def} locked sub="Up next" onOpen={() => onOpen(def)} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function BadgeTile({ def, verified = false, locked = false, sub, onOpen }: { def: BadgeDef; verified?: boolean; locked?: boolean; sub: string; onOpen: () => void }) {
  const Icon = locked ? Lock : ICONS[def.icon];
  const look = locked ? LOCKED_LOOK : TIER_LOOK[def.tier];
  return (
    <button
      type="button"
      onClick={onOpen}
      data-badge-key={def.key}
      className={`ea-interactive w-full h-full flex flex-col items-center text-center gap-1.5 rounded-lg px-2 py-3 ${locked ? 'opacity-60' : ''}`}
      aria-label={`${def.label}${locked ? ' — not yet earned' : ''}${verified ? ' — verified' : ''}`}
    >
      <span className={`relative flex items-center justify-center w-12 h-12 rounded-full ${look.circle}`}>
        <Icon className={`w-6 h-6 ${look.icon}`} aria-hidden />
        {verified && (
          <BadgeCheck className="absolute -bottom-1 -right-1 w-5 h-5 text-brand bg-surface rounded-full" aria-hidden />
        )}
      </span>
      <span className="text-sm font-semibold text-primary leading-tight">{def.label}</span>
      <span className="text-xs text-muted">{sub}</span>
    </button>
  );
}

function BadgeChip({ view, onOpen }: { view: BadgeView; onOpen: () => void }) {
  const Icon = ICONS[view.def.icon];
  const look = TIER_LOOK[view.def.tier];
  return (
    <button
      type="button"
      role="listitem"
      onClick={onOpen}
      data-badge-key={view.key}
      className={`ea-interactive inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium ${look.chip}`}
    >
      <Icon className="w-4 h-4" aria-hidden />
      {view.def.label}
      {view.verified && <BadgeCheck className="w-4 h-4 text-brand" aria-label="Verified" />}
    </button>
  );
}

function BadgeDetail({ item, onClose }: { item: BadgeView | BadgeDef; onClose: () => void }) {
  const earned = 'def' in item ? item : null;
  const def = earned ? earned.def : (item as BadgeDef);
  const Icon = earned ? ICONS[def.icon] : Lock;
  const look = earned ? TIER_LOOK[def.tier] : LOCKED_LOOK;
  const line = earned ? earnedLine(earned) : null;
  return (
    <LargerWindow title={def.label} subtitle={sportName(def.sportKey)} onClose={onClose} windowKey="badge-detail">
      <div className="flex flex-col items-center text-center gap-3 py-2">
        <span className={`flex items-center justify-center w-20 h-20 rounded-full ${look.circle}`}>
          <Icon className={`w-10 h-10 ${look.icon}`} aria-hidden />
        </span>
        <p className="text-base text-primary">{def.description}</p>
        {earned ? (
          <>
            {line && <p className="text-h3 text-primary font-bold">{line}</p>}
            <p className="text-sm text-muted">Earned {formatDateOnly(earned.earnedOn)}</p>
            <p className={`inline-flex items-center gap-1.5 text-sm font-medium ${earned.verified ? 'text-brand' : 'text-muted'}`}>
              {earned.verified && <BadgeCheck className="w-4 h-4" aria-hidden />}
              {earned.verified ? 'Verified — from an official result' : 'From a self-reported result'}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted">Not earned yet — it unlocks automatically when a result qualifies.</p>
        )}
        <p className="text-xs text-muted capitalize">{def.tier}</p>
      </div>
    </LargerWindow>
  );
}
