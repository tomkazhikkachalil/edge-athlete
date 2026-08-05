'use client';

import { Trophy, Medal, Landmark, CalendarRange } from 'lucide-react';
import type { AchievementStats } from '@/lib/achievements/display';

/**
 * The trophy case's opening line: career totals as stat tiles (headline
 * numbers are tiles, not charts — dataviz form rule). Always unfiltered/
 * all-time. Zeros render honestly: a brand-new athlete sees "0", not a
 * dashed apology box.
 */

interface AchievementsHeroProps {
  stats: AchievementStats;
}

function Tile({
  icon: Icon, value, label, sub,
}: {
  icon: typeof Trophy; value: string; label: string; sub?: string;
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
      <div className="flex items-center justify-center gap-1.5 mb-1">
        <Icon className="w-4 h-4 text-gray-400" aria-hidden="true" />
        <span className="text-2xl font-bold text-gray-900 tabular-nums">{value}</span>
      </div>
      <div className="text-xs text-gray-500 uppercase tracking-wide">{label}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5 tabular-nums">{sub}</div>}
    </div>
  );
}

export default function AchievementsHero({ stats }: AchievementsHeroProps) {
  const span =
    stats.yearsActive >= 2 && stats.firstYear !== null && stats.lastYear !== null
      ? `${stats.firstYear}–${stats.lastYear}`
      : undefined;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <Tile icon={Trophy} value={String(stats.total)} label="Achievements" />
      <Tile icon={Medal} value={String(stats.podiums)} label="Podium finishes" />
      <Tile icon={Landmark} value={String(stats.organizations)} label="Organizations" />
      <Tile icon={CalendarRange} value={String(stats.yearsActive)} label="Years active" sub={span} />
    </div>
  );
}
