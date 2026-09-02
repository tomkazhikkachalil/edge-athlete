// ── Golf league bells (phase 6d W2, mig 173) ────────────────────────────────
// The member feedback loop: a member's posted round COUNTED for a league
// week (from the sync engine — only when the result is new or changed,
// never on an idempotent re-sync), the week is FINAL (the organizer
// confirmed; rank included), and the WINDOW CLOSES tomorrow with nothing
// posted yet (the daily cron, once per member per round). The
// registration/notify charter: never-throws best-effort, DIRECT admin
// inserts (create_notification's preference gate would silently drop
// these types), self-contained titles (they land verbatim in the email
// digest), metadata as the dedupe key and the e2e disambiguator. A
// supervised member's bell is COPIED to their guardians (the roster-invite
// cross-notify model). A 23514 on a pre-173 CHECK only drops the bell.
//
// Convenience surfaces, never safety surfaces: nothing here relaxes a
// guardian rail — a guardian sees exactly what their child sees.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgSide } from '@/lib/orgs/authz';
import { notifyGuardians, type GuardianNotificationType } from '@/lib/guardian-notify';
import { formatIsoDate } from './golf-weeks';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[GOLF LEAGUE NOTIFY]';

export interface GolfLeagueBellContext {
  side: OrgSide;
  orgId: string;
  orgName: string;
  competitionId: string;
  competitionName: string;
  contestId: string;
  roundLabel: string | null;
}

export interface CountedMember {
  profileId: string;
  gross: number | null;
  net: number | null;
  holes: number | null;
  roundId: string | null;
  /** true when a prior result for this round is being replaced. */
  changed: boolean;
}

export interface ConfirmedMember {
  profileId: string;
  rank: number | null;
  of: number;
}

// ── Pure copy (node-tested) ─────────────────────────────────────────────────

export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

const roundName = (ctx: Pick<GolfLeagueBellContext, 'roundLabel'>) => ctx.roundLabel ?? 'this round';

export function countedTitle(ctx: Pick<GolfLeagueBellContext, 'roundLabel' | 'competitionName'>, m: CountedMember): string {
  const holes = m.holes ? `${m.holes}-hole ` : '';
  const score = m.gross !== null ? `${m.gross}` : 'round';
  const net = m.net !== null ? ` (net ${m.net})` : '';
  const verb = m.changed ? 'now counts' : 'counts';
  return `Your ${holes}${score}${net} ${verb} for ${roundName(ctx)} in ${ctx.competitionName}`;
}

export function confirmedTitle(ctx: Pick<GolfLeagueBellContext, 'roundLabel' | 'competitionName'>, m: ConfirmedMember): string {
  const base = `${roundName(ctx)} in ${ctx.competitionName} is final`;
  return m.rank ? `${base} — you're ${ordinal(m.rank)} of ${m.of}` : base;
}

export function closingTitle(ctx: Pick<GolfLeagueBellContext, 'roundLabel' | 'competitionName'>): string {
  return `${roundName(ctx)} in ${ctx.competitionName} closes tomorrow — no round posted yet`;
}

export function closingMessage(courseName: string | null, playTo: string): string {
  return courseName
    ? `Post a round at ${courseName} by ${formatIsoDate(playTo)}.`
    : `Post a round by ${formatIsoDate(playTo)}.`;
}

/** Who gets the window-closing nudge: members with no result on file for
 *  the round and no nudge already sent for it. Pure, so the cron's
 *  once-per-member-per-round rule is testable without a clock. */
export function planWindowReminders(input: {
  members: { profileId: string; participantId: string }[];
  resultParticipantIds: Set<string>;
  alreadyNotifiedProfileIds: Set<string>;
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of input.members) {
    if (seen.has(m.profileId)) continue;
    seen.add(m.profileId);
    if (input.resultParticipantIds.has(m.participantId)) continue;
    if (input.alreadyNotifiedProfileIds.has(m.profileId)) continue;
    out.push(m.profileId);
  }
  return out;
}

// ── I/O ─────────────────────────────────────────────────────────────────────

const actionUrl = (ctx: GolfLeagueBellContext) => `/${ctx.side}/${ctx.orgId}`;

/** The org's name + side for the copy — one read, never throws. */
export async function loadGolfLeagueBellContext(
  admin: Admin,
  input: {
    competition: { id: string; name: string | null; league_id: string | null; club_id: string | null };
    contest: { id: string; round: string | null };
  }
): Promise<GolfLeagueBellContext | null> {
  const side: OrgSide = input.competition.league_id ? 'league' : 'club';
  const orgId = input.competition.league_id ?? input.competition.club_id;
  if (!orgId) return null;
  const { data: org } = await admin
    .from(side === 'league' ? 'leagues' : 'clubs')
    .select('id, name')
    .eq('id', orgId)
    .maybeSingle();
  return {
    side,
    orgId,
    orgName: (org?.name as string | undefined) ?? (side === 'league' ? 'the league' : 'the club'),
    competitionId: input.competition.id,
    competitionName: input.competition.name ?? 'the league',
    contestId: input.contest.id,
    roundLabel: input.contest.round,
  };
}

async function supervisedSet(admin: Admin, profileIds: string[]): Promise<Set<string>> {
  if (profileIds.length === 0) return new Set();
  const { data } = await admin.from('profiles').select('id, supervision_state').in('id', profileIds);
  return new Set((data ?? []).filter(p => p.supervision_state === 'supervised').map(p => p.id as string));
}

interface Bell {
  profileId: string;
  title: string;
  message: string | null;
  metadata: Record<string, unknown>;
}

/** One batched insert for the members, then a guardian copy per
 *  supervised member (its own best-effort fan-out). */
async function sendBells(
  admin: Admin,
  type: GuardianNotificationType,
  ctx: GolfLeagueBellContext,
  bells: Bell[]
): Promise<void> {
  if (bells.length === 0) return;
  try {
    const { error } = await admin.from('notifications').insert(
      bells.map(b => ({
        user_id: b.profileId,
        type,
        actor_id: null,
        title: b.title,
        message: b.message,
        action_url: actionUrl(ctx),
        is_read: false,
        metadata: b.metadata,
      }))
    );
    if (error) {
      if (error.code === '23514') {
        console.warn(`${TAG} ${type} not in notifications_type_check yet — run migration 173`);
      } else {
        console.error(`${TAG} ${type} insert failed:`, error);
      }
      return;
    }
    const supervised = await supervisedSet(
      admin,
      bells.map(b => b.profileId)
    );
    for (const b of bells) {
      if (!supervised.has(b.profileId)) continue;
      await notifyGuardians(admin, b.profileId, {
        type,
        title: b.title,
        message: b.message,
        actionUrl: actionUrl(ctx),
        metadata: b.metadata,
      });
    }
  } catch (e) {
    console.error(`${TAG} ${type} failed:`, e);
  }
}

/** The sync counted (or re-counted) these members' rounds. */
export async function notifyGolfRoundsCounted(
  admin: Admin,
  ctx: GolfLeagueBellContext,
  members: CountedMember[]
): Promise<void> {
  await sendBells(
    admin,
    'golf_league_round_counted',
    ctx,
    members.map(m => ({
      profileId: m.profileId,
      title: countedTitle(ctx, m),
      message: 'Posted from your round — the organizer confirms when the week closes.',
      metadata: {
        golf_league: 'counted',
        contest_id: ctx.contestId,
        competition_id: ctx.competitionId,
        round_id: m.roundId,
      },
    }))
  );
}

/** The organizer confirmed the round: it is final, with the rank. */
export async function notifyGolfRoundConfirmed(
  admin: Admin,
  ctx: GolfLeagueBellContext,
  members: ConfirmedMember[]
): Promise<void> {
  await sendBells(
    admin,
    'golf_league_round_confirmed',
    ctx,
    members.map(m => ({
      profileId: m.profileId,
      title: confirmedTitle(ctx, m),
      message: null,
      metadata: { golf_league: 'confirmed', contest_id: ctx.contestId, competition_id: ctx.competitionId },
    }))
  );
}

/** The window closes tomorrow and these members have nothing posted. */
export async function notifyGolfWindowClosing(
  admin: Admin,
  ctx: GolfLeagueBellContext & { courseName: string | null; playTo: string },
  profileIds: string[]
): Promise<void> {
  await sendBells(
    admin,
    'golf_league_window_closing',
    ctx,
    profileIds.map(profileId => ({
      profileId,
      title: closingTitle(ctx),
      message: closingMessage(ctx.courseName, ctx.playTo),
      metadata: { golf_league: 'closing', contest_id: ctx.contestId, competition_id: ctx.competitionId },
    }))
  );
}
