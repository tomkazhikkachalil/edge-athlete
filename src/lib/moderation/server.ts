/**
 * Moderation — the writers (Support & Reporting, Spec 2; migration 223).
 * Server-only, the service role. Every act stamps the ticket that caused it
 * and appends an `action_taken` row to the ticket's history; every act is
 * idempotent (hiding a hidden post is a no-op) and never throws — a failed
 * act logs and answers false so a route can say so.
 *
 *   hideContent / unhideContent      a post or a comment: status ↔ 'hidden'
 *   freezeConversation / unfreeze    a DM thread: frozen_at
 *   setModerationState               the profile column + the Supabase Auth
 *                                    ban for suspended / banned
 *   repeatIncidents                  the ≥ 2-in-90-days rule
 *   applyIntake                      what a Critical report does at submit
 *   applyResolutionAction            what the resolution code does at resolve
 *   runModerationLift                the daily-cron phase: expired suspensions
 *
 * Pre-223 (a column not live): a write answers 42703 / PGRST204 and the act
 * logs "run migration 223" and answers false — never a 500.
 */
import type { getSupabaseAdmin } from '@/lib/auth-server';
import { notifyGuardians } from '@/lib/guardian-notify';
import { emailService } from '@/lib/email-service';
import { isSyntheticEmail } from '@/lib/config/minors-config';
import { formatTicketNumber } from '@/lib/tickets/number';
import { STRIKE_CODES, type ResolutionCode, type TicketRow, type TicketTargetType } from '@/lib/tickets/types';
import {
  REPEAT_INCIDENT_WINDOW_DAYS,
  actionForResolution,
  authBanDurationFor,
  moderationNoticeCopy,
  shouldLimitAtIntake,
  type ModerationState,
  type ResolutionAction,
} from './state';

type Admin = ReturnType<typeof getSupabaseAdmin>;
const TAG = '[moderation]';
const NOT_LIVE = new Set(['42703', 'PGRST204', '42P01', 'PGRST205']);

function notLive(error: { code?: string } | null | undefined): boolean {
  return !!error?.code && NOT_LIVE.has(error.code);
}

async function record(admin: Admin, ticketId: string, actorId: string | null, action: string, detail?: string): Promise<void> {
  const { error } = await admin.from('ticket_events').insert({
    ticket_id: ticketId,
    actor_profile_id: actorId,
    kind: 'action_taken',
    old_value: null,
    new_value: action,
    body: detail ?? null,
    visible_to_user: false,
  });
  if (error) console.error(`${TAG} record failed:`, error.message);
}

// ── Content ─────────────────────────────────────────────────────────────────

export type ContentKind = 'post' | 'comment';
const TABLE: Record<ContentKind, 'posts' | 'post_comments'> = { post: 'posts', comment: 'post_comments' };

export async function hideContent(admin: Admin, kind: ContentKind, id: string, ticketId: string, actorId: string | null): Promise<boolean> {
  const { data, error } = await admin
    .from(TABLE[kind])
    .update({ status: 'hidden', hidden_at: new Date().toISOString(), hidden_ticket_id: ticketId })
    .eq('id', id)
    .neq('status', 'hidden')
    .select('id');
  if (error) {
    if (notLive(error)) console.warn(`${TAG} hide: run migration 223`);
    else console.error(`${TAG} hide failed:`, error.message);
    return false;
  }
  if ((data ?? []).length > 0) await record(admin, ticketId, actorId, `hide_${kind}`, id);
  return true;
}

export async function unhideContent(admin: Admin, kind: ContentKind, id: string, ticketId: string, actorId: string | null): Promise<boolean> {
  const { data, error } = await admin
    .from(TABLE[kind])
    .update({ status: 'published', hidden_at: null, hidden_ticket_id: null })
    .eq('id', id)
    .eq('status', 'hidden')
    .select('id');
  if (error) {
    if (notLive(error)) console.warn(`${TAG} unhide: run migration 223`);
    else console.error(`${TAG} unhide failed:`, error.message);
    return false;
  }
  if ((data ?? []).length > 0) await record(admin, ticketId, actorId, `unhide_${kind}`, id);
  return true;
}

// ── Conversations ───────────────────────────────────────────────────────────

export async function freezeConversation(admin: Admin, conversationId: string, ticketId: string, actorId: string | null): Promise<boolean> {
  const { data, error } = await admin
    .from('conversations')
    .update({ frozen_at: new Date().toISOString(), frozen_ticket_id: ticketId })
    .eq('id', conversationId)
    .is('frozen_at', null)
    .select('id');
  if (error) {
    if (notLive(error)) console.warn(`${TAG} freeze: run migration 223`);
    else console.error(`${TAG} freeze failed:`, error.message);
    return false;
  }
  if ((data ?? []).length > 0) await record(admin, ticketId, actorId, 'freeze_conversation', conversationId);
  return true;
}

export async function unfreezeConversation(admin: Admin, conversationId: string, ticketId: string, actorId: string | null): Promise<boolean> {
  const { data, error } = await admin
    .from('conversations')
    .update({ frozen_at: null, frozen_ticket_id: null })
    .eq('id', conversationId)
    .not('frozen_at', 'is', null)
    .select('id');
  if (error) {
    if (notLive(error)) console.warn(`${TAG} unfreeze: run migration 223`);
    else console.error(`${TAG} unfreeze failed:`, error.message);
    return false;
  }
  if ((data ?? []).length > 0) await record(admin, ticketId, actorId, 'unfreeze_conversation', conversationId);
  return true;
}

/** Is this conversation frozen? (pre-223: never) */
export async function conversationFrozen(admin: Admin, conversationId: string): Promise<boolean> {
  const { data, error } = await admin.from('conversations').select('frozen_at').eq('id', conversationId).maybeSingle();
  if (error) return false;
  return !!data?.frozen_at;
}

// ── The account ─────────────────────────────────────────────────────────────

export async function setModerationState(
  admin: Admin,
  profileId: string,
  state: ModerationState,
  opts: { until?: Date | null; ticketId: string | null; actorId: string | null; note?: string }
): Promise<boolean> {
  const until = state === 'suspended' ? (opts.until ?? null) : null;
  const { error } = await admin
    .from('profiles')
    .update({ moderation_state: state, moderation_until: until ? until.toISOString() : null, moderation_ticket_id: state === 'active' ? null : opts.ticketId })
    .eq('id', profileId);
  if (error) {
    if (notLive(error)) console.warn(`${TAG} state: run migration 223`);
    else console.error(`${TAG} state failed:`, error.message);
    return false;
  }
  // Suspended / banned are also refused at LOGIN — Supabase Auth's ban; a
  // live session's JWT lasts until it expires, and the write gate covers it.
  if (state === 'suspended' || state === 'banned' || state === 'active') {
    const { error: authError } = await admin.auth.admin.updateUserById(profileId, { ban_duration: authBanDurationFor(state, until) });
    if (authError) console.error(`${TAG} auth ban update failed:`, authError.message);
  }
  if (opts.ticketId) await record(admin, opts.ticketId, opts.actorId, `state_${state}`, opts.note ?? (until ? `until ${until.toISOString()}` : undefined));
  return true;
}

/** Report tickets against a user in the window, excluding one ticket (the one being filed) and merged rows. */
export async function repeatIncidents(admin: Admin, profileId: string, excludeTicketId: string | null, now: Date = new Date()): Promise<number> {
  const since = new Date(now.getTime() - REPEAT_INCIDENT_WINDOW_DAYS * 86_400_000).toISOString();
  let query = admin
    .from('tickets')
    .select('id', { count: 'exact', head: true })
    .eq('type', 'report')
    .eq('target_profile_id', profileId)
    .is('merged_into_id', null)
    .gte('created_at', since);
  if (excludeTicketId) query = query.neq('id', excludeTicketId);
  const { count, error } = await query;
  if (error) {
    console.error(`${TAG} repeat-incidents read failed:`, error.message);
    return 0;
  }
  return count ?? 0;
}

// ── Intake ──────────────────────────────────────────────────────────────────

export interface IntakeTarget {
  type: TicketTargetType;
  id: string;
  profileId: string | null;
  /** For a `message` target: its conversation (the freeze acts on the thread). */
  conversationId?: string | null;
}

/** What a report does at submit: a CRITICAL one acts on the interaction (hide / freeze); ANY report counts toward the repeat-incident rule, which alone limits the account. */
export async function applyIntake(admin: Admin, ticket: { id: string; severity: string }, target: IntakeTarget, reporterId: string): Promise<{ hidden: boolean; frozen: boolean; limited: boolean }> {
  const out = { hidden: false, frozen: false, limited: false };
  if (ticket.severity === 'critical') {
    if (target.type === 'post') out.hidden = await hideContent(admin, 'post', target.id, ticket.id, reporterId);
    else if (target.type === 'comment') out.hidden = await hideContent(admin, 'comment', target.id, ticket.id, reporterId);
    else if (target.type === 'conversation') out.frozen = await freezeConversation(admin, target.id, ticket.id, reporterId);
    else if (target.type === 'message' && target.conversationId) out.frozen = await freezeConversation(admin, target.conversationId, ticket.id, reporterId);
  }
  if (target.profileId) {
    const others = await repeatIncidents(admin, target.profileId, ticket.id);
    if (shouldLimitAtIntake(others)) {
      out.limited = await setModerationState(admin, target.profileId, 'limited', { ticketId: ticket.id, actorId: null, note: `repeat incidents: ${others} other reports in ${REPEAT_INCIDENT_WINDOW_DAYS} days` });
    }
  }
  return out;
}

// ── Resolution ──────────────────────────────────────────────────────────────

/** Undo what intake did for THIS ticket: unhide, unfreeze, lift a limit it set. */
async function restoreForTicket(admin: Admin, ticket: TicketRow, actorId: string | null): Promise<void> {
  if (ticket.target_type === 'post' && ticket.target_id) await unhideContent(admin, 'post', ticket.target_id, ticket.id, actorId);
  if (ticket.target_type === 'comment' && ticket.target_id) await unhideContent(admin, 'comment', ticket.target_id, ticket.id, actorId);
  const conversationId = ticket.target_type === 'conversation' ? ticket.target_id : ticket.target_type === 'message' ? (ticket.content_snapshot?.conversation_id as string | undefined) ?? null : null;
  if (conversationId) await unfreezeConversation(admin, conversationId, ticket.id, actorId);
  if (ticket.target_profile_id) {
    const { data: p } = await admin.from('profiles').select('moderation_state, moderation_ticket_id').eq('id', ticket.target_profile_id).maybeSingle();
    if (p?.moderation_state === 'limited' && p.moderation_ticket_id === ticket.id) {
      await setModerationState(admin, ticket.target_profile_id, 'active', { ticketId: ticket.id, actorId });
    }
  }
}

/** The resolution code IS the action. Returns what the reported user should be told (null = nothing). */
export async function applyResolutionAction(admin: Admin, ticket: TicketRow, actorId: string, now: Date = new Date()): Promise<{ action: ResolutionAction; noticed: boolean }> {
  const action = actionForResolution(ticket.resolution_code);
  if (ticket.type !== 'report' || action.kind === 'none') return { action, noticed: false };
  let until: Date | null = null;
  switch (action.kind) {
    case 'restore':
      await restoreForTicket(admin, ticket, actorId);
      break;
    case 'hide':
      if (ticket.target_type === 'post' && ticket.target_id) await hideContent(admin, 'post', ticket.target_id, ticket.id, actorId);
      if (ticket.target_type === 'comment' && ticket.target_id) await hideContent(admin, 'comment', ticket.target_id, ticket.id, actorId);
      // A limit set at intake ends with the decision; the content stays hidden.
      if (ticket.target_profile_id) await liftIntakeLimit(admin, ticket, actorId);
      break;
    case 'warn':
      if (ticket.target_profile_id) await liftIntakeLimit(admin, ticket, actorId);
      break;
    case 'suspend':
      until = new Date(now.getTime() + action.days * 86_400_000);
      if (ticket.target_profile_id) await setModerationState(admin, ticket.target_profile_id, 'suspended', { until, ticketId: ticket.id, actorId });
      break;
    case 'ban':
      if (ticket.target_profile_id) await setModerationState(admin, ticket.target_profile_id, 'banned', { ticketId: ticket.id, actorId });
      break;
  }
  const noticed = await noticeSubject(admin, ticket, action, until);
  return { action, noticed };
}

async function liftIntakeLimit(admin: Admin, ticket: TicketRow, actorId: string | null): Promise<void> {
  if (!ticket.target_profile_id) return;
  const { data: p } = await admin.from('profiles').select('moderation_state, moderation_ticket_id').eq('id', ticket.target_profile_id).maybeSingle();
  if (p?.moderation_state === 'limited' && p.moderation_ticket_id === ticket.id) {
    await setModerationState(admin, ticket.target_profile_id, 'active', { ticketId: ticket.id, actorId });
  }
}

/** The reported user's notice: a bell (`moderation_notice`), their guardians' copy when supervised, and the email. Never who reported. */
async function noticeSubject(admin: Admin, ticket: TicketRow, action: ResolutionAction, until: Date | null): Promise<boolean> {
  if (!ticket.target_profile_id) return false;
  const copy = moderationNoticeCopy(action, formatTicketNumber(ticket.number), ticket.resolution_note, until);
  if (!copy) return false;
  const actionUrl = `/settings?tab=support&ticket=${ticket.id}`;
  const { error } = await admin.from('notifications').insert({
    user_id: ticket.target_profile_id,
    type: 'moderation_notice',
    actor_id: null,
    title: copy.title,
    message: copy.message,
    action_url: actionUrl,
    is_read: false,
    metadata: { ticket_id: ticket.id, action: action.kind },
  });
  if (error) {
    if (error.code === '23514') console.warn(`${TAG} moderation_notice is not in the type CHECK — run migration 223`);
    else console.error(`${TAG} notice failed:`, error.message);
  }
  const { data: p } = await admin.from('profiles').select('email, supervision_state, first_name').eq('id', ticket.target_profile_id).maybeSingle();
  if (p?.supervision_state === 'supervised') {
    await notifyGuardians(admin, ticket.target_profile_id, {
      type: 'moderation_notice',
      title: `${p.first_name || 'Your athlete'}: ${copy.title}`,
      message: copy.message,
      actionUrl,
      metadata: { ticket_id: ticket.id, action: action.kind },
    });
  }
  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    const { recipientsFor } = await import('@/lib/tickets/mail');
    const to = await recipientsFor(admin, { id: ticket.id, reporter_profile_id: ticket.target_profile_id, reporter_email: p?.email && !isSyntheticEmail(p.email) && p.supervision_state !== 'supervised' ? p.email : null, guest_email: null });
    for (const address of to) await emailService.sendModerationNotice({ to: address, title: copy.title, message: copy.message, ticketId: ticket.id });
  }
  return true;
}

// ── The cron phase ──────────────────────────────────────────────────────────

/** Expired suspensions → active (and the auth ban lifted). Pre-223 a benign no-op. */
export async function runModerationLift(admin: Admin, now: Date = new Date()): Promise<{ ok: boolean; lifted: number }> {
  const { data, error } = await admin
    .from('profiles')
    .select('id, moderation_ticket_id')
    .eq('moderation_state', 'suspended')
    .not('moderation_until', 'is', null)
    .lte('moderation_until', now.toISOString())
    .limit(200);
  if (error) {
    if (notLive(error)) return { ok: true, lifted: 0 };
    console.error(`${TAG} lift read failed:`, error.message);
    return { ok: false, lifted: 0 };
  }
  let lifted = 0;
  for (const row of data ?? []) {
    if (await setModerationState(admin, row.id, 'active', { ticketId: row.moderation_ticket_id ?? null, actorId: null, note: 'suspension expired' })) lifted += 1;
  }
  return { ok: true, lifted };
}

/** The strike count the ladder reads: closed report tickets resolved warning · suspension · ban against the user. */
export async function strikeCount(admin: Admin, profileId: string): Promise<number> {
  const { count } = await admin.from('tickets').select('id', { count: 'exact', head: true }).eq('target_profile_id', profileId).in('resolution_code', [...STRIKE_CODES]);
  return count ?? 0;
}

export type { ResolutionCode };
