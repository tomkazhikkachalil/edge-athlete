'use client';

import { useEffect, useState } from 'react';
import { ORG_ROUTE_FAMILY, type OrgKind } from '@/lib/orgs/org-ref';

// ── Carry rosters into the new season (teams & divisions program, PR 11) ────
// Inside the console's Roll forward form: one checkbox per team entered in
// the closing season — "Carry roster forward (N players)", off by default
// (rosters start empty unless the manager says so) — and a Select all. The
// counts are the team's CURRENT roster (/api/{plural}/[id]/teams). Carried
// players are told; a minor's guardians get a copy (the rollover route).

interface Props {
  side: OrgKind;
  orgId: string;
  teams: { id: string; name: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
}

export default function RolloverCarryPicker({ side, orgId, teams, selected, onChange }: Props) {
  const [players, setPlayers] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/${ORG_ROUTE_FAMILY[side]}/${orgId}/teams`, { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as { teams?: { id: string; players: number }[] };
        if (!cancelled) setPlayers(new Map((body.teams ?? []).map(t => [t.id, t.players])));
      } catch {
        /* counts are a courtesy — the checkboxes work without them */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [side, orgId]);

  if (teams.length === 0) return null;
  const all = teams.every(t => selected.includes(t.id));
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);

  return (
    <fieldset className="mt-3 space-y-1" data-rollover-carry="">
      <legend className="text-xs font-medium text-secondary mb-1">Rosters</legend>
      <p className="text-xs text-muted mb-1">Rosters start empty unless you carry a team forward. Carried players are told, and so are a minor’s guardians.</p>
      <label className="flex items-center gap-3 min-h-[44px] text-sm text-primary">
        <input type="checkbox" checked={all} onChange={() => onChange(all ? [] : teams.map(t => t.id))} />
        <span className="font-medium">Select all</span>
      </label>
      {teams.map(t => {
        const n = players.get(t.id);
        return (
          <label key={t.id} className="flex items-center gap-3 min-h-[44px] text-sm text-primary">
            <input type="checkbox" checked={selected.includes(t.id)} onChange={() => toggle(t.id)} aria-label={`Carry ${t.name}'s roster forward`} />
            <span>
              {t.name}
              <span className="text-muted">{` — carry roster forward${n === undefined ? '' : ` (${n} ${n === 1 ? 'player' : 'players'})`}`}</span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
