// ── Backup status — does someone else hold the keys? (Authority PR 2) ──────
// Tom: "there always needs to be two accounts to create an event, tourney,
// club, league" — as a WARNING, never a block (his call). Pure: the banner,
// the org checklist and the event page all read these two answers.
//
//   ok       — a second person can run it
//   pending  — a backup has been invited but has not accepted yet (events)
//   none     — nobody else can run it
//   n/a      — the event is over (completed / cancelled): its results stand

export type BackupState = 'ok' | 'pending' | 'none' | 'n/a';

export interface BackupCandidate {
  profileId: string;
  /** Holds authority: not limited / suspended / banned, not departed. */
  holdsAuthority: boolean;
}

export interface EventBackupInput {
  status: string;
  hostProfileId: string;
  rows: Array<{ profileId: string; role: string; status: string }>;
  holdsAuthority: (profileId: string) => boolean;
}

export function eventBackupStatus(input: EventBackupInput): BackupState {
  if (input.status === 'completed' || input.status === 'cancelled') return 'n/a';
  const others = input.rows.filter(r => r.profileId !== input.hostProfileId && (r.role === 'organizer' || r.role === 'co_organizer'));
  if (others.some(r => r.status === 'accepted' && input.holdsAuthority(r.profileId))) return 'ok';
  if (others.some(r => r.status === 'invited')) return 'pending';
  return 'none';
}

export interface OrgBackupInput {
  /** Active owner / manager membership rows (kind follow, scope org, status active). */
  rows: Array<{ profileId: string; role: string; status: string }>;
  holdsAuthority: (profileId: string) => boolean;
}

/** An org is backed up when TWO distinct people who hold authority are an
 *  active owner or manager (Tom: a co-owner or a manager counts; staff don't). */
export function orgBackupStatus(input: OrgBackupInput): BackupState {
  const people = new Set(
    input.rows
      .filter(r => (r.role === 'owner' || r.role === 'manager') && r.status === 'active' && input.holdsAuthority(r.profileId))
      .map(r => r.profileId)
  );
  return people.size >= 2 ? 'ok' : 'none';
}
