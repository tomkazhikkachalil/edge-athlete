/**
 * Moderation — the pure rules (Support & Reporting, Spec 2; migration 223).
 *
 *   profiles.moderation_state ∈ active | limited | suspended | banned
 *
 * Tom's rules (Sep 20 2026): a single report acts on the INTERACTION (a
 * post / comment hidden, a DM thread frozen); the ACCOUNT is limited only
 * on repeat incidents or by an admin; the ladder — warning, then a 7-day
 * suspension, then a ban — is guidance the admin sees beside the resolve
 * form, and the resolution code they pick IS the action. Pure; pinned in
 * __tests__/moderation.test.ts.
 */
import type { ResolutionCode } from '@/lib/tickets/types';

export const MODERATION_STATES = ['active', 'limited', 'suspended', 'banned'] as const;
export type ModerationState = (typeof MODERATION_STATES)[number];

export const SUSPENSION_DAYS = 7;
/** Two or more OTHER report tickets against the same user in this window limit the account at intake. */
export const REPEAT_INCIDENT_THRESHOLD = 2;
export const REPEAT_INCIDENT_WINDOW_DAYS = 90;
/** The doc's rule: three or more merged reports on a High item hide it before review. */
export const PILE_ON_HIDE_COUNT = 3;

export interface ModerationFacts {
  moderation_state?: string | null;
  moderation_until?: string | null;
}

/** The state that applies NOW: a suspension whose `moderation_until` has passed reads as active (the cron lifts it later). Pre-223 (no column) = active. */
export function effectiveState(p: ModerationFacts | null | undefined, now: Date = new Date()): ModerationState {
  const s = p?.moderation_state;
  if (s !== 'limited' && s !== 'suspended' && s !== 'banned') return 'active';
  if (s === 'suspended' && p?.moderation_until && Date.parse(p.moderation_until) <= now.getTime()) return 'active';
  return s;
}

/** May this account write content or contact people right now? */
export function mayWrite(p: ModerationFacts | null | undefined, now: Date = new Date()): boolean {
  return effectiveState(p, now) === 'active';
}

/** Authority (240): may this account RUN a club, league or event right now?
 *  Tom's rule: a limited, suspended or banned account loses its org and event
 *  authority; a departed tombstone holds none. An expired suspension is
 *  active again (effectiveState). */
export function holdsAuthority(p: (ModerationFacts & { departed_at?: string | null }) | null | undefined, now: Date = new Date()): boolean {
  if (p?.departed_at) return false;
  return effectiveState(p, now) === 'active';
}

/** The words a refused write answers with. */
export function writeRefusalMessage(state: ModerationState, until: string | null | undefined): string {
  switch (state) {
    case 'limited':
      return 'Your account is read-only while we review a report. You can still read, and reply to support under Settings → Support.';
    case 'suspended':
      return until
        ? `Your account is suspended until ${new Date(until).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}. You can reply to support under Settings → Support.`
        : 'Your account is suspended. You can reply to support under Settings → Support.';
    case 'banned':
      return 'This account has been banned.';
    default:
      return '';
  }
}

/** The ladder, as guidance: what the next confirmed violation would ordinarily draw. */
export function ladderSuggestion(priorStrikes: number): Extract<ResolutionCode, 'warning' | 'suspension' | 'ban'> {
  if (priorStrikes <= 0) return 'warning';
  if (priorStrikes === 1) return 'suspension';
  return 'ban';
}

export type ResolutionAction =
  | { kind: 'none' }
  | { kind: 'restore' }               // no_action / declined: undo what intake did
  | { kind: 'hide' }                  // content_removed: keep or make the content hidden
  | { kind: 'warn' }
  | { kind: 'suspend'; days: number }
  | { kind: 'ban' };

/** The resolution code IS the action (the doc: "pick one action code"). */
export function actionForResolution(code: ResolutionCode | null): ResolutionAction {
  switch (code) {
    case 'no_action':
    case 'declined':
      return { kind: 'restore' };
    case 'content_removed':
      return { kind: 'hide' };
    case 'warning':
      return { kind: 'warn' };
    case 'suspension':
      return { kind: 'suspend', days: SUSPENSION_DAYS };
    case 'ban':
      return { kind: 'ban' };
    default:
      return { kind: 'none' };
  }
}

/** Repeat incidents: `others` = report tickets against the user in the window, excluding this one. */
export function shouldLimitAtIntake(otherReportsInWindow: number): boolean {
  return otherReportsInWindow >= REPEAT_INCIDENT_THRESHOLD;
}

/** The Supabase Auth `ban_duration` for a state: hours for a suspension, a century for a ban, 'none' to lift. */
export function authBanDurationFor(state: ModerationState, until: Date | null, now: Date = new Date()): string {
  if (state === 'banned') return '876000h';
  if (state === 'suspended' && until) {
    const hours = Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 3_600_000));
    return `${hours}h`;
  }
  return 'none';
}

/** The plain-words notice the reported user receives — ONLY when something was done to them (a report closed with no action is never announced: reports are anonymous, and a notice would reveal one was filed). Never who reported. */
export function moderationNoticeCopy(action: ResolutionAction, ticketNumber: string, note: string | null, until: Date | null): { title: string; message: string } | null {
  const why = note ? ` ${note}` : '';
  switch (action.kind) {
    case 'warn':
      return { title: `A warning about your account (${ticketNumber})`, message: `Something you posted or sent broke our community rules.${why} A further violation may suspend your account. You can reply once under Settings → Support if you disagree.` };
    case 'suspend':
      return {
        title: `Your account is suspended (${ticketNumber})`,
        message: `Your account is suspended${until ? ` until ${until.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}` : ` for ${action.days} days`}.${why} You can reply once under Settings → Support if you disagree.`,
      };
    case 'ban':
      return { title: `Your account has been banned (${ticketNumber})`, message: `Your account has been banned for breaking our community rules.${why} You can reply once under Settings → Support if you disagree.` };
    case 'hide':
      return { title: `Content removed (${ticketNumber})`, message: `Something you posted was removed for breaking our community rules.${why} You can reply once under Settings → Support if you disagree.` };
    default:
      return null;
  }
}
