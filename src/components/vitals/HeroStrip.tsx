'use client';

import { Dumbbell, Weight, Timer, Flame, Trophy, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { formatVolume, formatDuration } from '@/lib/workouts/summary';
import { categoryAccent, metricCategory } from './category-colors';
import type { WeeklySummary, LatestPB } from '@/lib/workouts/dashboard';

/**
 * The dashboard's opening line: this week's training load vs last week, the
 * streak, and the latest personal best. Stat tiles, not charts — a headline
 * number is a tile (dataviz form rule). Values wear ink; only the delta
 * glyphs carry color. Zeros render honestly: a brand-new athlete sees
 * "0 workouts", not a dashed apology box.
 */

interface HeroStripProps {
  summary: WeeklySummary;
  streak: number;
  pb: LatestPB | null;
}

function DeltaGlyph({ now, prior }: { now: number; prior: number }) {
  if (now === prior) return <Minus className="w-3.5 h-3.5 text-faint" aria-label="unchanged" />;
  return now > prior
    ? <TrendingUp className="w-3.5 h-3.5 text-emerald-600" aria-label="up vs last week" />
    : <TrendingDown className="w-3.5 h-3.5 text-red-500" aria-label="down vs last week" />;
}

function Tile({
  icon: Icon, value, label, delta,
}: {
  icon: typeof Dumbbell; value: string; label: string;
  delta?: { now: number; prior: number };
}) {
  return (
    <div className="bg-surface rounded-lg border border-border p-4 text-center">
      <div className="flex items-center justify-center gap-1.5 mb-1">
        <Icon className="w-4 h-4 text-faint" aria-hidden="true" />
        <span className="text-2xl font-bold text-primary tabular-nums">{value}</span>
        {delta && <DeltaGlyph now={delta.now} prior={delta.prior} />}
      </div>
      <div className="text-xs text-muted uppercase tracking-wide">{label}</div>
    </div>
  );
}

export default function HeroStrip({ summary, streak, pb }: HeroStripProps) {
  const accent = categoryAccent(pb ? metricCategory(pb.metricKey) : undefined);

  return (
    <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
      <Tile
        icon={Dumbbell}
        value={String(summary.workouts)}
        label="Workouts this week"
        delta={{ now: summary.workouts, prior: summary.prior.workouts }}
      />
      <Tile
        icon={Weight}
        value={summary.volumeLbs > 0 ? formatVolume(summary.volumeLbs) : '0 lbs'}
        label="Volume"
        delta={{ now: summary.volumeLbs, prior: summary.prior.volumeLbs }}
      />
      <Tile
        icon={Timer}
        value={summary.seconds > 0 ? formatDuration(summary.seconds) : '0 min'}
        label="Training time"
        delta={{ now: summary.seconds, prior: summary.prior.seconds }}
      />
      <Tile
        icon={Flame}
        value={String(streak)}
        label={streak === 1 ? 'Week streak' : 'Week streak'}
      />

      {/* PB spotlight — the newest all-time best, front and center */}
      <div className="col-span-2 bg-surface rounded-lg border border-border p-4 flex items-center gap-3">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${pb ? accent.chip : 'bg-surface-sunken'}`}>
          <Trophy className={`w-5 h-5 ${pb ? accent.text : 'text-faint'}`} aria-hidden="true" />
        </div>
        {pb ? (
          <div className="min-w-0">
            <div className="text-xs text-muted uppercase tracking-wide">Latest personal best</div>
            <div className="text-lg font-bold text-primary truncate tabular-nums">
              {pb.label} · {pb.valueDisplay}
            </div>
            <div className="text-xs text-muted">
              {new Date(pb.recordedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </div>
          </div>
        ) : (
          <div className="min-w-0">
            <div className="text-xs text-muted uppercase tracking-wide">Latest personal best</div>
            <div className="text-sm text-muted">Log a metric to start chasing PBs.</div>
          </div>
        )}
      </div>
    </div>
  );
}
