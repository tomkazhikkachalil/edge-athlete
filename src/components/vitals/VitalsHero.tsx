'use client';

import { Dumbbell, Weight, Timer, Trophy, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import LazyImage from '../LazyImage';
import ProgressRing from './ProgressRing';
import StreakBadge from './StreakBadge';
import { formatVolume, formatDuration } from '@/lib/workouts/summary';
import { parseDateLocal } from '@/lib/formatters';
import { isRecentPB } from '@/lib/vitals/derive';
import { categoryAccent, metricCategory } from './category-colors';
import type { WeeklySummary, LatestPB } from '@/lib/workouts/dashboard';

/**
 * The dashboard's opening card: greeting + avatar, the active-days ring,
 * this week's numbers, the streak, and the latest personal best. One bubble,
 * friendly and legible — values wear ink, color lives on the ring, glyphs,
 * and chips. Zeros render honestly: a brand-new athlete sees "0 workouts"
 * and a nudge, not a dashed apology box.
 */

interface HeroProfile {
  firstName: string | null;
  avatarUrl: string | null;
}

interface VitalsHeroProps {
  profile: HeroProfile | null;
  isOwnProfile: boolean;
  summary: WeeklySummary;
  streak: number;
  /** Distinct training days this week, 0..7 — the ring's fill. */
  activeDays: number;
  pb: LatestPB | null;
}

function DeltaGlyph({ now, prior }: { now: number; prior: number }) {
  if (now === prior) return <Minus className="w-3.5 h-3.5 text-faint" aria-label="unchanged" />;
  return now > prior
    ? <TrendingUp className="w-3.5 h-3.5 text-emerald-600" aria-label="up vs last week" />
    : <TrendingDown className="w-3.5 h-3.5 text-red-500" aria-label="down vs last week" />;
}

function Stat({
  icon: Icon, value, label, delta,
}: {
  icon: typeof Dumbbell; value: string; label: string;
  delta: { now: number; prior: number };
}) {
  return (
    <div className="text-center">
      <div className="flex items-center justify-center gap-1.5 mb-1">
        <Icon className="w-4 h-4 text-faint" aria-hidden="true" />
        <span className="text-2xl sm:text-3xl font-bold text-primary tabular-nums whitespace-nowrap">{value}</span>
        <DeltaGlyph now={delta.now} prior={delta.prior} />
      </div>
      <div className="text-xs text-muted uppercase tracking-wide">{label}</div>
    </div>
  );
}

export default function VitalsHero({
  profile, isOwnProfile, summary, streak, activeDays, pb,
}: VitalsHeroProps) {
  const firstName = profile?.firstName?.trim() || null;
  const greeting = isOwnProfile
    ? `Let's go${firstName ? `, ${firstName}` : ''}!`
    : firstName ? `${firstName}'s training` : 'Training snapshot';
  const accent = categoryAccent(pb ? metricCategory(pb.metricKey) : undefined);

  return (
    <section className="vt-card vt-pop-in p-5 sm:p-6">
      {/* Greeting row */}
      <div className="flex items-center gap-3 sm:gap-4">
        {profile?.avatarUrl ? (
          <LazyImage
            src={profile.avatarUrl}
            alt={`${firstName ?? 'Athlete'} avatar`}
            className="w-12 h-12 sm:w-14 sm:h-14 rounded-full object-cover shrink-0"
            width={56}
            height={56}
          />
        ) : (
          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-brand-soft flex items-center justify-center shrink-0" aria-hidden="true">
            <Dumbbell className="w-6 h-6 text-brand-fg" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="text-xl sm:text-2xl font-bold text-primary truncate">{greeting}</h3>
          <p className="text-sm text-muted">This week at a glance</p>
        </div>
        <div className="shrink-0 hidden sm:block">
          <StreakBadge weeks={streak} />
        </div>
      </div>
      {/* On phones the badge drops under the greeting so it never squeezes it */}
      {streak > 0 && (
        <div className="mt-3 sm:hidden">
          <StreakBadge weeks={streak} />
        </div>
      )}

      {/* Ring + this-week numbers */}
      <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-4 sm:items-center">
        <div className="flex flex-col items-center gap-2">
          <ProgressRing
            value={activeDays / 7}
            color="var(--brand-fg)"
            ariaLabel={`Active ${activeDays} of 7 days this week`}
          >
            <span className="text-3xl font-bold text-primary tabular-nums">{activeDays}</span>
            <span className="text-[11px] text-muted uppercase tracking-wide">of 7 days</span>
          </ProgressRing>
          <span className="text-xs text-muted uppercase tracking-wide">Active days</span>
        </div>
        <Stat
          icon={Dumbbell}
          value={String(summary.workouts)}
          label="Workouts this week"
          delta={{ now: summary.workouts, prior: summary.prior.workouts }}
        />
        <Stat
          icon={Weight}
          value={summary.volumeLbs > 0 ? formatVolume(summary.volumeLbs) : '0 lbs'}
          label="Volume"
          delta={{ now: summary.volumeLbs, prior: summary.prior.volumeLbs }}
        />
        <Stat
          icon={Timer}
          value={summary.seconds > 0 ? formatDuration(summary.seconds) : '0 min'}
          label="Training time"
          delta={{ now: summary.seconds, prior: summary.prior.seconds }}
        />
      </div>

      {/* PB spotlight — the newest all-time best, front and center */}
      <div className="mt-6 flex items-center gap-3 rounded-2xl bg-surface-muted p-4">
        <div className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 ${pb ? accent.chip : 'bg-surface-sunken'}`}>
          <Trophy className={`w-5 h-5 ${pb ? accent.text : 'text-faint'}`} aria-hidden="true" />
        </div>
        {pb ? (
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted uppercase tracking-wide">Latest personal best</span>
              {isRecentPB(pb.recordedAt) && (
                <span className="vt-pop inline-flex rounded-full bg-amber-100 dark:bg-amber-900/60 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                  New!
                </span>
              )}
            </div>
            <div className="text-lg font-bold text-primary truncate tabular-nums">
              {pb.label} · {pb.valueDisplay}
            </div>
            <div className="text-xs text-muted">
              {/* parseDateLocal, not new Date(): recorded_at is a DATE column,
                  and UTC-midnight parsing shows the previous day in the US */}
              {parseDateLocal(pb.recordedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </div>
          </div>
        ) : (
          <div className="min-w-0">
            <div className="text-xs text-muted uppercase tracking-wide">Latest personal best</div>
            <div className="text-sm text-muted">Log a metric to start chasing PBs.</div>
          </div>
        )}
      </div>
    </section>
  );
}
