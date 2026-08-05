'use client';

import { Tag, Users, Flag, CalendarRange } from 'lucide-react';
import type { TaggedHeroStats } from '@/lib/tagged/display';

/**
 * The Tagged tab's opening line: how often, by how many people, across
 * which sports and years — stat tiles, ALL-TIME and never filtered.
 * Zeros render honestly (no dashed apology boxes in a hero).
 */

interface TaggedHeroProps {
  stats: TaggedHeroStats;
}

function Tile({
  icon: Icon, value, label, sub,
}: {
  icon: typeof Tag; value: string; label: string; sub?: string;
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

export default function TaggedHero({ stats }: TaggedHeroProps) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <Tile icon={Tag} value={String(stats.timesTagged)} label="Times tagged" />
      <Tile icon={Users} value={String(stats.taggerCount)} label="Tagged by" sub={stats.taggerCount === 1 ? 'athlete' : 'athletes'} />
      <Tile icon={Flag} value={String(stats.sportCount)} label="Sports" />
      <Tile icon={CalendarRange} value={String(stats.yearsActive)} label="Years active" sub={stats.yearSpan} />
    </div>
  );
}
