'use client';

import { useState } from 'react';
import { ORG_ROUTE_FAMILY, type OrgKind } from '@/lib/orgs/org-ref';
import type { OrgSwitches } from '@/lib/orgs/switches';

// ── What your org runs (teams & divisions program, Sep 26 2026) ─────────────
// The two switches — "We run teams" / "We run competitions" — each turn its
// part of the product on and off: the console sections, the org page's tiles
// and the public site's pages. Off HIDES; nothing is deleted, and turning it
// back on brings everything back as it was (Tom). Owners and managers only
// (manage_org — the org PATCH decides; this card only renders for them).
//
// 375px: one column, each switch a full-width 44px row.

interface Props {
  side: OrgKind;
  orgId: string;
  switches: OrgSwitches;
  /** What a hidden section keeps, in words ("4 teams and their rosters"). */
  teamCount: number;
  competitionCount: number;
  onSaved: (next: OrgSwitches) => void;
  onError: (message: string) => void;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export default function SettingsSection({ side, orgId, switches, teamCount, competitionCount, onSaved, onError }: Props) {
  const [saving, setSaving] = useState<keyof OrgSwitches | null>(null);

  const save = async (key: keyof OrgSwitches, value: boolean) => {
    setSaving(key);
    try {
      const res = await fetch(`/api/${ORG_ROUTE_FAMILY[side]}/${orgId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(key === 'teams' ? { operatesTeams: value } : { operatesCompetitions: value }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        onError(body.error || 'Could not save the setting');
        return;
      }
      onSaved({ ...switches, [key]: value });
    } catch {
      onError('Could not save the setting');
    } finally {
      setSaving(null);
    }
  };

  const rows: { key: keyof OrgSwitches; label: string; on: string; off: string }[] = [
    {
      key: 'teams',
      label: 'We run teams',
      on: 'Teams, their rosters and team pages show in your console, on your page and on your site.',
      off:
        teamCount > 0
          ? `Hidden. Your ${plural(teamCount, 'team', 'teams')} and their rosters are kept — turn this back on to bring them back.`
          : 'Hidden. Turn it on when you start running teams.',
    },
    {
      key: 'competitions',
      label: 'We run competitions',
      on: 'Leagues, standings and leaders show in your console, on your page and on your site.',
      off:
        competitionCount > 0
          ? `Hidden. Your ${plural(competitionCount, 'competition', 'competitions')} and their results are kept — turn this back on to bring them back.`
          : 'Hidden. Turn it on when you start running competitions.',
    },
  ];

  return (
    <section id="settings" aria-label="What you run" className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6" data-org-switches="">
      <h2 className="text-lg font-semibold text-primary mb-1">What you run</h2>
      <p className="text-sm text-tertiary mb-4">
        {`Turn off what your ${side} doesn't do. Nothing is deleted — a hidden part comes back exactly as you left it.`}
      </p>
      <ul className="space-y-3">
        {rows.map(row => {
          const on = switches[row.key];
          return (
            <li key={row.key} className="rounded-lg border border-border p-3">
              <label className="flex min-h-[44px] items-center justify-between gap-3 cursor-pointer">
                <span className="text-sm font-medium text-primary">{row.label}</span>
                <input
                  type="checkbox"
                  role="switch"
                  aria-checked={on}
                  checked={on}
                  disabled={saving !== null}
                  onChange={e => void save(row.key, e.target.checked)}
                  data-org-switch={row.key}
                  className="h-5 w-5 shrink-0 accent-violet-600"
                />
              </label>
              <p className="mt-1 text-xs text-muted" data-org-switch-note={row.key}>
                {on ? row.on : row.off}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
