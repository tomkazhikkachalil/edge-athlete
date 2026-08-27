'use client';

/**
 * Track & Field's full breakdown: the complete per-event PB table — every
 * event, each best carrying its provenance (a tracked PB from posted races
 * beats a self-reported one, even a faster claim) — plus the race log via
 * the shared stat-line breakdown (whose keyStat is already race-time
 * formatted by the schema headline).
 *
 * PB data comes from the sport's SkillCard: the track server module emits
 * one tile per event with PBs (headline = shortest event), so no extra
 * fetch is needed here.
 */

import type { SportSkillCard } from '@/lib/sports/server/types';
import { ProvenanceChip } from '../SportSkillCards';
import StatLineBreakdown from './StatLineBreakdown';

export default function TrackBreakdown({
  profileId,
  card,
}: {
  profileId: string;
  card: SportSkillCard;
}) {
  // Every event PB on the card: the headline (shortest event) + PB tiles.
  const pbRows = [
    ...(card.headline && card.headline.label.endsWith('PB')
      ? [{ label: card.headline.label, value: card.headline.value, provenance: card.headline.provenance }]
      : []),
    ...card.tiles.filter(t => t.label.endsWith('PB')),
  ];

  return (
    <div>
      {pbRows.length > 0 && (
        <div className="mb-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted border-b border-border-subtle">
                <th className="py-2 pr-4 font-semibold">Event</th>
                <th className="py-2 pr-4 font-semibold">Personal best</th>
                <th className="py-2 text-right font-semibold">Source</th>
              </tr>
            </thead>
            <tbody>
              {pbRows.map(row => (
                <tr key={row.label} className="border-b border-border-subtle/60 last:border-0">
                  <td className="py-2 pr-4 text-secondary">{row.label.replace(/ PB$/, '')}</td>
                  <td className="py-2 pr-4 font-bold text-primary tabular-nums">{row.value}</td>
                  <td className="py-2 text-right">
                    <ProvenanceChip provenance={row.provenance} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <StatLineBreakdown profileId={profileId} sportKey="track_field" />
    </div>
  );
}
