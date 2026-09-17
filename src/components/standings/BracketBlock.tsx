import BracketColumnsView from '@/components/competitions/BracketColumnsView';
import type { PublicBracketBlock } from '@/lib/competitions/public-standings';

/** The public bracket (track 2 PR 4): the columns from the CONTESTS, names masked by the reader; a slot links to its contest place. Server-safe. */
export default function BracketBlock({ bracket, basePath }: { bracket: PublicBracketBlock; basePath?: string }) {
  return (
    <div className="mt-4" data-standings-bracket="">
      <BracketColumnsView
        winner={bracket.champion}
        columns={bracket.columns.map(col => ({
          key: String(col.stage),
          name: col.name,
          slots: col.slots.map(s => ({
            key: `${col.stage}:${s.slot}`,
            title: `Match ${s.slot}`,
            result: s.scoreline,
            href: s.contestId ? `${basePath ? `${basePath}/schedule` : '/event'}/${s.contestId}` : null,
            sides: [s.home, s.away].map((side, i) => ({ key: side?.entryId ?? `empty-${i}`, label: side?.name ?? (col.stage === 1 ? 'Bye' : 'TBD'), won: !!side && s.winnerEntryId === side.entryId, empty: !side })),
          })),
        }))}
      />
    </div>
  );
}
