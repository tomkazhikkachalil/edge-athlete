'use client';

/** The headline tiles of a level (career or a season) — the sport's own profile tiles, computed over the counted games. */
export default function Tiles({ tiles }: { tiles: Array<{ label: string; value: string | null }> }) {
  const shown = tiles.filter(t => t.value !== null);
  if (shown.length === 0) return null;
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-sport-tiles="">
      {shown.map(t => (
        <div key={t.label} className="ea-surface rounded-lg p-3">
          <dt className="text-xs text-muted">{t.label}</dt>
          <dd className="text-2xl font-bold tabular-nums text-primary">{t.value}</dd>
        </div>
      ))}
    </dl>
  );
}
