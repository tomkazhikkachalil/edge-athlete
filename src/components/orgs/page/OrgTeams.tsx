'use client';

import Link from 'next/link';
import type { OrgKind } from '@/lib/orgs/org-ref';

// ── The org page's Teams tile + window (teams & divisions program, PR 8) ─────
// The read is /api/{plural}/[id]/teams (the org's rules: a private org's
// teams are for members; a switched-off Teams part reads empty). The window
// lists the teams — logo or colours, name, how many play — each a door to
// its in-app page (/{side}/[id]/teams/[teamId]).

export interface TeamsRead {
  count: number;
  first: string | null;
  canManage: boolean;
  teams: { id: string; name: string; logoUrl: string | null; primaryColor: string | null; secondaryColor: string | null; players: number }[];
}

export const pickTeams = (body: unknown): TeamsRead => {
  const b = body as { teams?: TeamsRead['teams']; canManage?: boolean };
  const teams = b.teams ?? [];
  return { count: teams.length, first: teams[0]?.name ?? null, canManage: b.canManage === true, teams };
};

function Mark({ team }: { team: TeamsRead['teams'][number] }) {
  if (team.logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- the tokenless team-logo streamer, busted by ?v (the org-logo precedent)
    return <img src={team.logoUrl} alt="" className="h-10 w-10 shrink-0 rounded-md border border-border object-contain bg-surface" />;
  }
  const bg = team.primaryColor ? (team.secondaryColor ? `linear-gradient(135deg, ${team.primaryColor}, ${team.secondaryColor})` : team.primaryColor) : undefined;
  return (
    <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-surface-muted text-sm font-semibold text-secondary" style={bg ? { background: bg } : undefined}>
      {bg ? '' : team.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function TeamsWindow({ side, orgId, read }: { side: OrgKind; orgId: string; read: TeamsRead }) {
  if (read.teams.length === 0) {
    return (
      <div className="text-sm text-tertiary">
        <p>No teams yet.</p>
        {read.canManage && (
          <Link href={`/app/org/${side}/${orgId}#teams`} className="mt-2 inline-block font-medium text-brand-fg hover:text-brand-fg-strong">
            Add a team in the console →
          </Link>
        )}
      </div>
    );
  }
  return (
    <ul className="space-y-2" data-org-teams="">
      {read.teams.map(team => (
        <li key={team.id}>
          <Link href={`/${side}/${orgId}/teams/${team.id}`} className="ea-interactive flex min-h-[56px] items-center gap-3 rounded-lg border border-border p-2" data-org-team={team.id}>
            <Mark team={team} />
            <span className="min-w-0">
              <span className="block truncate font-medium text-primary">{team.name}</span>
              <span className="block text-xs text-muted">{team.players === 1 ? '1 player' : `${team.players} players`}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
