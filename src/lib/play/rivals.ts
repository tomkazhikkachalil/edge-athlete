import type { HeadToHead } from './versus';

/** The rivals view's shapes — pure, client-safe (the Stats hub's RivalsPanel
 *  reads them; rivals-server.ts writes them). The Play program (244). */

export interface RivalPerson {
  profileId: string;
  name: string;
  handle: string | null;
  avatarUrl: string | null;
}

export interface Rival {
  person: RivalPerson;
  record: HeadToHead;
  shown: boolean;
}

export interface RivalsView {
  /** The athlete (or a guardian) — sees every rival and the toggles. */
  selfView: boolean;
  canManage: boolean;
  rivals: Rival[];
  /** The viewer's own record against the athlete, from the VIEWER's side. */
  yours: HeadToHead | null;
}
