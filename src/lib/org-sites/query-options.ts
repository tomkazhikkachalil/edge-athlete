import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgSide } from '@/lib/orgs/authz';
import { fetchPublicVenues } from './public-data';

/**
 * The entity pickers' option lists — Site Builder P9-B (Sep 9 2026).
 *
 * What the properties panel offers a query widget to bind to: the org's
 * competitions (with their season label) and its venues. The competitions
 * list MIRRORS the filters of `fetchPublicStandings`
 * (src/lib/competitions/public-standings.ts, the public read the standings
 * widget renders from: `visibility = 'public'`, `status in (active,
 * completed)`, newest first) so the panel never offers a competition the
 * public page cannot show. Editor-only (the canvas GET, `no-store`); never
 * throws — an unreadable list is an empty list.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

export interface CanvasOptions {
  competitions: { id: string; name: string; seasonLabel: string | null; status: string }[];
  venues: { id: string; name: string }[];
}

export const EMPTY_OPTIONS: CanvasOptions = { competitions: [], venues: [] };

export async function fetchCanvasOptions(admin: Admin, side: OrgSide, orgId: string): Promise<CanvasOptions> {
  const orgColumn = side === 'league' ? 'league_id' : 'club_id';
  const [competitions, venues] = await Promise.all([
    (async () => {
      try {
        const { data, error } = await admin
          .from('competitions')
          .select('id, name, season_id, status')
          .eq(orgColumn, orgId)
          .eq('visibility', 'public')
          .in('status', ['active', 'completed'])
          .order('created_at', { ascending: false })
          .limit(50);
        if (error || !data || data.length === 0) return [];
        const seasonIds = [...new Set(data.map(c => c.season_id as string | null).filter((v): v is string => !!v))];
        const { data: seasons } = seasonIds.length ? await admin.from('seasons').select('id, label').in('id', seasonIds) : { data: [] as { id: string; label: string }[] };
        const label = new Map((seasons ?? []).map(s => [s.id as string, s.label as string]));
        return data.map(c => ({
          id: c.id as string,
          name: c.name as string,
          seasonLabel: c.season_id ? (label.get(c.season_id as string) ?? null) : null,
          status: c.status as string,
        }));
      } catch {
        return [];
      }
    })(),
    (async () => {
      try {
        return (await fetchPublicVenues(admin, side, orgId)).map(v => ({ id: v.id, name: v.name }));
      } catch {
        return [];
      }
    })(),
  ]);
  return { competitions, venues };
}
