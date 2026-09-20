/**
 * The ticket writer and readers (Spec 1) — server-only, the service role.
 *
 * ONE writer for every ticket row and every history row: the routes call
 * these and never touch `tickets` / `ticket_events` themselves. Every read
 * goes out through a projection (`visibility.ts`) — posture A means the
 * projection IS the access rule. Pre-222 (the tables not live) every read
 * answers `supported: false` and every write throws `TicketsNotLive`, which
 * the routes turn into a 503 by name — never a 500, never a silent success.
 *
 * Bells and emails are best-effort and AWAITED after the origin write (the
 * house rule): a failed bell logs; the ticket exists either way. Emails are
 * SMTP-guarded at the call site like every other sender.
 */
import { getSupabaseAdmin, OWNER_EMAILS } from '@/lib/auth-server';
import { emailService } from '@/lib/email-service';
import { notifyGuardians } from '@/lib/guardian-notify';
import { isSyntheticEmail } from '@/lib/config/minors-config';
import { publicDisplayName } from '@/lib/orgs/public-names';
import { emailSentEvent, eventsForChange, maskEmail, noteEvent, replyToUserEvent, userReplyEvent, type AdminPatch } from './events';
import { formatTicketNumber } from './number';
import { SEVERITY_RANK, isOverdue, severityFor } from './severity';
import { transitionForUserReply, USER_REPLY_REFUSALS, validateAdminTransition } from './transitions';
import {
  STRIKE_CODES,
  type TicketEventInput,
  type TicketEventRow,
  type TicketRow,
  type TicketSeverity,
  type TicketStatus,
  type TicketSubtype,
  type TicketType,
} from './types';
import { projectTicketForAdmin, projectTicketForUser, userVisibleEvents, type AdminTicketView, type UserEventView, type UserTicketView } from './visibility';

type Admin = ReturnType<typeof getSupabaseAdmin>;

const TAG = '[tickets]';

/** PostgREST filter hygiene (the admin/users shape): strip the delimiters, escape the LIKE wildcards. */
function sanitizeForFilter(input: string): string {
  return input.replace(/[,()"]/g, ' ').replace(/[%_\\]/g, m => `\\${m}`).trim();
}
const NOT_LIVE_CODES = new Set(['42P01', 'PGRST205']);

/** Thrown by a write when 222 has not run; the route answers 503 by name. */
export class TicketsNotLive extends Error {
  constructor() {
    super('Support is not available yet.');
    this.name = 'TicketsNotLive';
  }
}

function isNotLive(error: { code?: string } | null | undefined): boolean {
  return !!error?.code && NOT_LIVE_CODES.has(error.code);
}

const TICKET_COLUMNS =
  'id, number, type, subtype, reason, severity, status, subject, description, reporter_profile_id, reporter_email, guest_email, target_type, target_id, target_profile_id, content_snapshot, attachment_url, report_count, merged_into_id, assignee_profile_id, resolution_code, resolution_note, suggestion_tag, contact_ok, appeal_used_at, first_response_at, resolved_at, closed_at, anonymized_at, created_at, updated_at';

const EVENT_COLUMNS = 'id, ticket_id, actor_profile_id, kind, old_value, new_value, body, visible_to_user, created_at';

const SMTP_CONFIGURED = () => !!(process.env.SMTP_USER && process.env.SMTP_PASS);

// ── Who is asking ───────────────────────────────────────────────────────────

export interface Submitter {
  id: string;
  email: string | null;
  supervised: boolean;
  firstName: string | null;
}

/** The submitter as the ticket records them: a supervised profile carries no email. */
export async function readSubmitter(admin: Admin, userId: string): Promise<Submitter> {
  const { data } = await admin.from('profiles').select('email, supervision_state, first_name').eq('id', userId).maybeSingle();
  const supervised = data?.supervision_state === 'supervised';
  const email = data?.email && !isSyntheticEmail(data.email) ? data.email : null;
  return { id: userId, email: supervised ? null : email, supervised, firstName: data?.first_name ?? null };
}

/** The profiles this user may read tickets for: their own + their supervised, non-parked athletes. */
export async function readerScope(admin: Admin, userId: string): Promise<Set<string>> {
  const scope = new Set<string>([userId]);
  const { data: rows } = await admin
    .from('profile_access')
    .select('profiles!profile_access_profile_id_fkey(id, supervision_state, deletion_requested_at)')
    .eq('user_id', userId)
    .eq('role', 'guardian');
  for (const r of rows ?? []) {
    const raw = (r as { profiles: unknown }).profiles;
    const p = (Array.isArray(raw) ? raw[0] : raw) as { id: string; supervision_state: string | null; deletion_requested_at: string | null } | null;
    if (p && p.supervision_state === 'supervised' && !p.deletion_requested_at) scope.add(p.id);
  }
  return scope;
}

// ── Create ──────────────────────────────────────────────────────────────────

export interface CreateTicketInput {
  type: TicketType;
  subtype?: TicketSubtype | null;
  reason: string;
  subject?: string | null;
  description: string;
  contact_ok?: boolean;
  submitter: Submitter;
  /** Spec 2 fills these; Spec 1's incident report carries none. */
  target?: { type: TicketRow['target_type']; id: string | null; profileId: string | null; isMinor: boolean; snapshot: Record<string, unknown> | null } | null;
}

export async function createTicket(admin: Admin, input: CreateTicketInput): Promise<{ id: string; number: number; severity: TicketSeverity }> {
  const severity = severityFor({ type: input.type, reason: input.reason, targetIsMinor: input.target?.isMinor ?? false });
  const row = {
    type: input.type,
    subtype: input.type === 'report' ? (input.subtype ?? 'incident') : null,
    reason: input.reason,
    severity,
    subject: input.subject ?? null,
    description: input.description,
    reporter_profile_id: input.submitter.id,
    reporter_email: input.submitter.email,
    target_type: input.target?.type ?? null,
    target_id: input.target?.id ?? null,
    target_profile_id: input.target?.profileId ?? null,
    content_snapshot: input.target?.snapshot ?? null,
    contact_ok: input.contact_ok ?? true,
  };
  const { data, error } = await admin.from('tickets').insert(row).select('id, number').single();
  if (error || !data) {
    if (isNotLive(error)) throw new TicketsNotLive();
    console.error(`${TAG} insert failed:`, error?.message);
    throw new Error('Could not create the ticket');
  }
  const ticket = { id: data.id as string, number: Number(data.number), severity };

  await appendEvents(admin, [
    { ticket_id: ticket.id, actor_profile_id: input.submitter.id, kind: 'created', old_value: null, new_value: input.type, body: null, visible_to_user: true },
  ]);

  // Bells + mail, best-effort, after the write.
  if (severity === 'critical') await bellAdminsCritical(admin, ticket.id, ticket.number, input.type, input.reason);
  if (input.submitter.supervised) {
    await notifyGuardians(admin, input.submitter.id, {
      type: 'ticket_update',
      title: `${input.submitter.firstName || 'Your athlete'} opened a support request (${formatTicketNumber(ticket.number)})`,
      message: input.type === 'report' ? 'They reported something. Our team will review it.' : 'You can follow it under My requests.',
      actionUrl: `/settings?tab=support&ticket=${ticket.id}`,
      actorId: input.submitter.id,
      metadata: { ticket_id: ticket.id, ticket_type: input.type },
    }, input.submitter.id);
  }
  await sendTicketMail(admin, ticket.id, 'created');
  return ticket;
}

// ── User reads + replies ────────────────────────────────────────────────────

export type SupportedList<T> = { supported: true; items: T[] } | { supported: false; items: [] };

export async function readMyTickets(admin: Admin, scope: Set<string>): Promise<SupportedList<UserTicketView>> {
  const { data, error } = await admin
    .from('tickets')
    .select(TICKET_COLUMNS)
    .in('reporter_profile_id', [...scope])
    .is('merged_into_id', null)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) {
    if (isNotLive(error)) return { supported: false, items: [] };
    console.error(`${TAG} my-tickets read failed:`, error.message);
    throw new Error('Could not load your requests');
  }
  return { supported: true, items: ((data ?? []) as TicketRow[]).map(projectTicketForUser) };
}

export async function readTicketForUser(
  admin: Admin,
  ticketId: string,
  scope: Set<string>
): Promise<{ ticket: UserTicketView; events: UserEventView[] } | null> {
  const { data, error } = await admin.from('tickets').select(TICKET_COLUMNS).eq('id', ticketId).maybeSingle();
  if (error) {
    if (isNotLive(error)) return null;
    throw new Error('Could not load the request');
  }
  const t = data as TicketRow | null;
  if (!t || !t.reporter_profile_id || !scope.has(t.reporter_profile_id)) return null;
  const events = await readEvents(admin, ticketId);
  return { ticket: projectTicketForUser(t), events: userVisibleEvents(events, scope) };
}

export type UserReplyOutcome =
  | { ok: true; status: TicketStatus; appeal: boolean }
  | { ok: false; status: 404 | 409; error: string };

export async function appendUserReply(admin: Admin, ticketId: string, actorId: string, scope: Set<string>, body: string): Promise<UserReplyOutcome> {
  const { data, error } = await admin.from('tickets').select('id, status, appeal_used_at, reporter_profile_id, number').eq('id', ticketId).maybeSingle();
  if (error) {
    if (isNotLive(error)) throw new TicketsNotLive();
    throw new Error('Could not load the request');
  }
  const t = data as Pick<TicketRow, 'id' | 'status' | 'appeal_used_at' | 'reporter_profile_id' | 'number'> | null;
  if (!t || !t.reporter_profile_id || !scope.has(t.reporter_profile_id)) return { ok: false, status: 404, error: 'Not found' };

  const next = transitionForUserReply(t);
  if (!next.ok) return { ok: false, status: 409, error: USER_REPLY_REFUSALS[next.reason] };

  const events: TicketEventInput[] = [userReplyEvent(ticketId, actorId, body)];
  const patch: Record<string, unknown> = {};
  if (next.next !== t.status) {
    patch.status = next.next;
    events.unshift({ ticket_id: ticketId, actor_profile_id: actorId, kind: next.reopened ? 'reopened' : 'status_changed', old_value: t.status, new_value: next.next, body: null, visible_to_user: true });
  }
  if (next.appeal) {
    // The appeal reopens: the CHECK allows a resolution code only on resolved / closed.
    patch.appeal_used_at = new Date().toISOString();
    patch.resolved_at = null;
    patch.resolution_code = null;
  }
  if (Object.keys(patch).length > 0) {
    // Compare-and-set on the status the reply was written against.
    const { data: updated, error: updateError } = await admin.from('tickets').update(patch).eq('id', ticketId).eq('status', t.status).select('id');
    if (updateError) throw new Error('Could not update the request');
    if (!updated || updated.length === 0) return { ok: false, status: 409, error: 'This request changed while you were writing. Reload and try again.' };
  }
  await appendEvents(admin, events);
  return { ok: true, status: next.next, appeal: next.appeal };
}

// ── Admin reads ─────────────────────────────────────────────────────────────

export interface QueueFilters {
  status?: TicketStatus | 'open' | 'all';
  type?: TicketType;
  severity?: TicketSeverity;
  q?: string;
}

export interface QueueCounts {
  openByType: Record<TicketType, number>;
  openBySeverity: Record<TicketSeverity, number>;
  overdue: number;
}

export type QueueResult = { supported: true; tickets: AdminTicketView[]; counts: QueueCounts } | { supported: false; tickets: []; counts: QueueCounts };

const EMPTY_COUNTS = (): QueueCounts => ({
  openByType: { help: 0, report: 0, suggestion: 0 },
  openBySeverity: { low: 0, medium: 0, high: 0, critical: 0 },
  overdue: 0,
});

const OPEN_STATUSES: TicketStatus[] = ['new', 'in_review', 'waiting_on_user'];

export async function readQueue(admin: Admin, filters: QueueFilters, now = new Date()): Promise<QueueResult> {
  let query = admin.from('tickets').select(TICKET_COLUMNS).is('merged_into_id', null).order('created_at', { ascending: true }).limit(200);
  const status = filters.status ?? 'open';
  if (status === 'open') query = query.in('status', OPEN_STATUSES);
  else if (status !== 'all') query = query.eq('status', status);
  if (filters.type) query = query.eq('type', filters.type);
  if (filters.severity) query = query.eq('severity', filters.severity);
  if (filters.q) {
    const n = /^\s*EA-?(\d+)\s*$/i.exec(filters.q);
    if (n) query = query.eq('number', Number(n[1]));
    else query = query.ilike('subject', `%${sanitizeForFilter(filters.q)}%`); // hardening-ok: sanitizeForFilter strips delimiters and escapes wildcards
  }
  const [{ data, error }, openRes] = await Promise.all([
    query,
    admin.from('tickets').select('type, severity, created_at, first_response_at, status').in('status', OPEN_STATUSES).is('merged_into_id', null).limit(2000),
  ]);
  if (error) {
    if (isNotLive(error)) return { supported: false, tickets: [], counts: EMPTY_COUNTS() };
    console.error(`${TAG} queue read failed:`, error.message);
    throw new Error('Could not load the queue');
  }
  const tickets = ((data ?? []) as TicketRow[])
    .map(t => projectTicketForAdmin(t, now))
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.created_at.localeCompare(b.created_at));

  const counts = EMPTY_COUNTS();
  for (const t of (openRes.data ?? []) as Array<Pick<TicketRow, 'type' | 'severity' | 'created_at' | 'first_response_at' | 'status'>>) {
    counts.openByType[t.type] += 1;
    counts.openBySeverity[t.severity] += 1;
    if (isOverdue(t, now)) counts.overdue += 1;
  }
  return { supported: true, tickets, counts };
}

export interface PersonContext {
  profileId: string;
  name: string;
  handle: string | null;
  accountAgeDays: number | null;
  ticketsFiled: number;
  ticketsAgainst: number;
  strikes: number;
}

export interface AdminTicketDetail {
  ticket: AdminTicketView;
  events: Array<TicketEventRow & { actorName: string | null }>;
  reporter: PersonContext | null;
  target: PersonContext | null;
  assignees: Array<{ profile_id: string; role: string; name: string }>;
}

export async function readTicketForAdmin(admin: Admin, ticketId: string, now = new Date()): Promise<AdminTicketDetail | null> {
  const { data, error } = await admin.from('tickets').select(TICKET_COLUMNS).eq('id', ticketId).maybeSingle();
  if (error) {
    if (isNotLive(error)) return null;
    throw new Error('Could not load the ticket');
  }
  const t = data as TicketRow | null;
  if (!t) return null;
  const [events, reporter, target, assignees] = await Promise.all([
    readEvents(admin, ticketId),
    t.reporter_profile_id ? personContext(admin, t.reporter_profile_id) : Promise.resolve(null),
    t.target_profile_id ? personContext(admin, t.target_profile_id) : Promise.resolve(null),
    readAssignees(admin),
  ]);
  const actorIds = [...new Set(events.map(e => e.actor_profile_id).filter((id): id is string => !!id))];
  const names = await displayNames(admin, actorIds);
  return {
    ticket: projectTicketForAdmin(t, now),
    events: events.map(e => ({ ...e, actorName: e.actor_profile_id ? (names.get(e.actor_profile_id) ?? null) : null })),
    reporter,
    target,
    assignees,
  };
}

async function personContext(admin: Admin, profileId: string): Promise<PersonContext | null> {
  const [{ data: p }, filed, against, strikes] = await Promise.all([
    admin.from('profiles').select('id, first_name, middle_name, last_name, full_name, handle, email, visibility, supervision_state, created_at').eq('id', profileId).maybeSingle(),
    admin.from('tickets').select('id', { count: 'exact', head: true }).eq('reporter_profile_id', profileId),
    admin.from('tickets').select('id', { count: 'exact', head: true }).eq('target_profile_id', profileId),
    admin.from('tickets').select('id', { count: 'exact', head: true }).eq('target_profile_id', profileId).in('resolution_code', [...STRIKE_CODES]),
  ]);
  if (!p) return null;
  const created = p.created_at ? Date.parse(p.created_at) : NaN;
  return {
    profileId,
    name: publicDisplayName(p),
    handle: p.handle ?? null,
    accountAgeDays: Number.isFinite(created) ? Math.floor((Date.now() - created) / 86_400_000) : null,
    ticketsFiled: filed.count ?? 0,
    ticketsAgainst: against.count ?? 0,
    strikes: strikes.count ?? 0,
  };
}

async function displayNames(admin: Admin, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const { data } = await admin.from('profiles').select('id, first_name, middle_name, last_name, full_name, email, visibility, supervision_state').in('id', ids);
  for (const p of data ?? []) out.set(p.id, publicDisplayName(p));
  return out;
}

/** Everyone who may be assigned: the roles table plus the env-allowlisted owners. */
export async function readAssignees(admin: Admin): Promise<Array<{ profile_id: string; role: string; name: string }>> {
  const { data: rows, error } = await admin.from('platform_admins').select('profile_id, role');
  if (error && !isNotLive(error)) console.error(`${TAG} assignees read failed:`, error.message);
  const byId = new Map<string, string>();
  for (const r of rows ?? []) byId.set(r.profile_id, r.role);
  const ownerEmails = ownerEmailList();
  if (ownerEmails.length > 0) {
    const { data: owners } = await admin.from('profiles').select('id').in('email', ownerEmails);
    for (const o of owners ?? []) byId.set(o.id, 'owner');
  }
  const names = await displayNames(admin, [...byId.keys()]);
  return [...byId.entries()].map(([profile_id, role]) => ({ profile_id, role, name: names.get(profile_id) ?? 'Admin' }));
}

function ownerEmailList(): string[] {
  const env = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  return [...new Set([...OWNER_EMAILS, ...env])];
}

// ── Admin writes ────────────────────────────────────────────────────────────

export type AdminPatchOutcome =
  | { ok: true; ticket: AdminTicketView }
  | { ok: false; status: 400 | 404 | 409; error: string };

export async function applyAdminPatch(admin: Admin, ticketId: string, actorId: string, patch: AdminPatch, now = new Date()): Promise<AdminPatchOutcome> {
  const { data, error } = await admin.from('tickets').select(TICKET_COLUMNS).eq('id', ticketId).maybeSingle();
  if (error) {
    if (isNotLive(error)) throw new TicketsNotLive();
    throw new Error('Could not load the ticket');
  }
  const before = data as TicketRow | null;
  if (!before) return { ok: false, status: 404, error: 'Not found' };

  if (patch.status !== undefined && patch.status !== before.status) {
    const t = validateAdminTransition(before.status, patch.status);
    if (!t.ok) return { ok: false, status: 409, error: USER_REPLY_REFUSALS[t.reason] };
    if (patch.status === 'resolved' && !(patch.resolution_code ?? before.resolution_code)) {
      return { ok: false, status: 400, error: 'Resolving needs a resolution code.' };
    }
  }

  const { events, stamps } = eventsForChange(before, patch, actorId, now);
  const update: Record<string, unknown> = { ...stamps };
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.severity !== undefined) update.severity = patch.severity;
  if (patch.assignee_profile_id !== undefined) update.assignee_profile_id = patch.assignee_profile_id;
  if (patch.resolution_code !== undefined) update.resolution_code = patch.resolution_code;
  if (patch.resolution_note !== undefined) update.resolution_note = patch.resolution_note;
  if (patch.suggestion_tag !== undefined) update.suggestion_tag = patch.suggestion_tag;
  // A reopen clears the resolution so the CHECK (a code only on resolved/closed) holds.
  if (events.some(e => e.kind === 'reopened')) {
    update.resolution_code = null;
  }
  if (Object.keys(update).length === 0) return { ok: false, status: 400, error: 'Nothing to change.' };

  const { data: updated, error: updateError } = await admin.from('tickets').update(update).eq('id', ticketId).eq('updated_at', before.updated_at).select(TICKET_COLUMNS).maybeSingle();
  if (updateError) {
    console.error(`${TAG} patch failed:`, updateError.message);
    throw new Error('Could not update the ticket');
  }
  if (!updated) return { ok: false, status: 409, error: 'The ticket changed under you. Reload and try again.' };
  await appendEvents(admin, events);

  const after = updated as TicketRow;
  const statusChanged = patch.status !== undefined && patch.status !== before.status;
  if (statusChanged) {
    if (after.status === 'resolved' || after.status === 'closed') {
      await bellSubmitter(admin, after, `${formatTicketNumber(after.number)} was ${after.status}`, after.resolution_note ?? 'Open it under My requests to read the outcome.');
      await sendTicketMail(admin, after.id, 'resolved');
    } else if (after.status === 'waiting_on_user') {
      await bellSubmitter(admin, after, `${formatTicketNumber(after.number)} needs a reply from you`, 'Our team asked a question. Open it under My requests.');
      await sendTicketMail(admin, after.id, 'waiting');
    }
  }
  return { ok: true, ticket: projectTicketForAdmin(after, now) };
}

export async function appendAdminNote(admin: Admin, ticketId: string, actorId: string, body: string): Promise<boolean> {
  const exists = await ticketExists(admin, ticketId);
  if (!exists) return false;
  await appendEvents(admin, [noteEvent(ticketId, actorId, body)]);
  await stampFirstResponse(admin, ticketId);
  return true;
}

export async function replyToUser(admin: Admin, ticketId: string, actorId: string, body: string, setWaiting: boolean): Promise<{ ok: true; status: TicketStatus } | { ok: false; status: 404 | 409; error: string }> {
  const { data, error } = await admin.from('tickets').select(TICKET_COLUMNS).eq('id', ticketId).maybeSingle();
  if (error) {
    if (isNotLive(error)) throw new TicketsNotLive();
    throw new Error('Could not load the ticket');
  }
  const t = data as TicketRow | null;
  if (!t) return { ok: false, status: 404, error: 'Not found' };
  if (t.status === 'closed') return { ok: false, status: 409, error: 'Reopen the ticket before replying.' };

  const events: TicketEventInput[] = [replyToUserEvent(ticketId, actorId, body)];
  const update: Record<string, unknown> = {};
  if (!t.first_response_at) update.first_response_at = new Date().toISOString();
  let status = t.status;
  if (setWaiting && t.status !== 'waiting_on_user' && t.status !== 'resolved') {
    events.push({ ticket_id: ticketId, actor_profile_id: actorId, kind: 'status_changed', old_value: t.status, new_value: 'waiting_on_user', body: null, visible_to_user: true });
    update.status = 'waiting_on_user';
    status = 'waiting_on_user';
  }
  if (Object.keys(update).length > 0) {
    const { error: updateError } = await admin.from('tickets').update(update).eq('id', ticketId);
    if (updateError) throw new Error('Could not update the ticket');
  }
  await appendEvents(admin, events);
  await bellSubmitter(admin, t, `Support replied on ${formatTicketNumber(t.number)}`, body.length > 140 ? `${body.slice(0, 137)}…` : body);
  await sendTicketMail(admin, ticketId, 'waiting', body);
  return { ok: true, status };
}

export async function deleteTicket(admin: Admin, ticketId: string): Promise<boolean> {
  const { data, error } = await admin.from('tickets').delete().eq('id', ticketId).select('id');
  if (error) {
    if (isNotLive(error)) throw new TicketsNotLive();
    throw new Error('Could not delete the ticket');
  }
  return (data ?? []).length > 0;
}

export interface TicketStats {
  supported: boolean;
  counts: QueueCounts;
  resolvedLast90d: number;
  medianHoursToResolve: number | null;
}

export async function readStats(admin: Admin, now = new Date()): Promise<TicketStats> {
  const since = new Date(now.getTime() - 90 * 86_400_000).toISOString();
  const [queue, resolvedRes] = await Promise.all([
    readQueue(admin, { status: 'open' }, now),
    admin.from('tickets').select('created_at, resolved_at').not('resolved_at', 'is', null).gte('resolved_at', since).limit(2000),
  ]);
  if (!queue.supported) return { supported: false, counts: queue.counts, resolvedLast90d: 0, medianHoursToResolve: null };
  const hours = ((resolvedRes.data ?? []) as Array<{ created_at: string; resolved_at: string }>)
    .map(r => (Date.parse(r.resolved_at) - Date.parse(r.created_at)) / 3_600_000)
    .filter(h => Number.isFinite(h) && h >= 0)
    .sort((a, b) => a - b);
  const median = hours.length === 0 ? null : hours[Math.floor((hours.length - 1) / 2)];
  return { supported: true, counts: queue.counts, resolvedLast90d: hours.length, medianHoursToResolve: median === null ? null : Math.round(median * 10) / 10 };
}

// ── Retention (the daily cron phase) ────────────────────────────────────────

export const TICKET_RETENTION_DAYS = 730;

/** Two years after close: null the personal columns, keep the audit columns, stamp anonymized_at. */
export async function runTicketAnonymize(admin: Admin, now = new Date()): Promise<{ ok: boolean; anonymized: number }> {
  const cutoff = new Date(now.getTime() - TICKET_RETENTION_DAYS * 86_400_000).toISOString();
  const { data: due, error } = await admin
    .from('tickets')
    .select('id')
    .not('closed_at', 'is', null)
    .is('anonymized_at', null)
    .lt('closed_at', cutoff)
    .limit(200);
  if (error) {
    if (isNotLive(error)) return { ok: true, anonymized: 0 }; // pre-222
    console.error(`${TAG} anonymize read failed:`, error.message);
    return { ok: false, anonymized: 0 };
  }
  let anonymized = 0;
  for (const row of due ?? []) {
    const stamp = now.toISOString();
    const { error: e1 } = await admin
      .from('tickets')
      .update({ reporter_profile_id: null, reporter_email: null, guest_email: null, description: null, subject: null, content_snapshot: { anonymized: true }, attachment_url: null, anonymized_at: stamp })
      .eq('id', row.id)
      .is('anonymized_at', null);
    if (e1) {
      console.error(`${TAG} anonymize update failed:`, row.id, e1.message);
      continue;
    }
    // The history keeps its shape and loses its words — the ONE UPDATE the append-only table ever sees.
    const { error: e2 } = await admin.from('ticket_events').update({ body: null, actor_profile_id: null }).eq('ticket_id', row.id);
    if (e2) console.error(`${TAG} anonymize events failed:`, row.id, e2.message);
    await appendEvents(admin, [{ ticket_id: row.id, actor_profile_id: null, kind: 'anonymized', old_value: null, new_value: stamp, body: null, visible_to_user: false }]);
    anonymized += 1;
  }
  return { ok: true, anonymized };
}

// ── Shared internals ────────────────────────────────────────────────────────

async function ticketExists(admin: Admin, ticketId: string): Promise<boolean> {
  const { data, error } = await admin.from('tickets').select('id').eq('id', ticketId).maybeSingle();
  if (error && isNotLive(error)) throw new TicketsNotLive();
  return !!data;
}

async function stampFirstResponse(admin: Admin, ticketId: string): Promise<void> {
  await admin.from('tickets').update({ first_response_at: new Date().toISOString() }).eq('id', ticketId).is('first_response_at', null);
}

async function readEvents(admin: Admin, ticketId: string): Promise<TicketEventRow[]> {
  const { data, error } = await admin.from('ticket_events').select(EVENT_COLUMNS).eq('ticket_id', ticketId).order('created_at', { ascending: true }).limit(500);
  if (error) {
    if (isNotLive(error)) return [];
    console.error(`${TAG} events read failed:`, error.message);
    return [];
  }
  return (data ?? []) as TicketEventRow[];
}

/** One row per statement, in order: rows of one batch would share created_at (one transaction), and the history is read by it. */
async function appendEvents(admin: Admin, events: TicketEventInput[]): Promise<void> {
  for (const event of events) {
    const { error } = await admin.from('ticket_events').insert(event);
    if (error) console.error(`${TAG} history append failed:`, error.message);
  }
}

/** The submitter's bell (and their guardians' when supervised). */
async function bellSubmitter(admin: Admin, t: Pick<TicketRow, 'id' | 'reporter_profile_id' | 'type'>, title: string, message: string): Promise<void> {
  if (!t.reporter_profile_id) return;
  const actionUrl = `/settings?tab=support&ticket=${t.id}`;
  const { error } = await admin.from('notifications').insert({
    user_id: t.reporter_profile_id,
    type: 'ticket_update',
    actor_id: null,
    title,
    message,
    action_url: actionUrl,
    is_read: false,
    metadata: { ticket_id: t.id, ticket_type: t.type },
  });
  if (error) {
    if (error.code === '23514') console.warn(`${TAG} ticket_update is not in the type CHECK — run migration 222`);
    else console.error(`${TAG} bell failed:`, error.message);
    return;
  }
  const { data: p } = await admin.from('profiles').select('supervision_state').eq('id', t.reporter_profile_id).maybeSingle();
  if (p?.supervision_state === 'supervised') {
    await notifyGuardians(admin, t.reporter_profile_id, { type: 'ticket_update', title, message, actionUrl, metadata: { ticket_id: t.id, ticket_type: t.type } });
  }
}

/** Every owner and moderator hears a Critical ticket now; the urgent-email sweep mails it within ten minutes. */
async function bellAdminsCritical(admin: Admin, ticketId: string, number: number, type: TicketType, reason: string): Promise<void> {
  try {
    const assignees = await readAssignees(admin);
    if (assignees.length === 0) {
      console.warn(`${TAG} a Critical ticket has NO admin to bell:`, ticketId);
      return;
    }
    const { error } = await admin.from('notifications').insert(
      assignees.map(a => ({
        user_id: a.profile_id,
        type: 'ticket_critical',
        actor_id: null,
        title: `Critical ${type}: ${formatTicketNumber(number)}`,
        message: `Reason: ${reason.replace(/_/g, ' ')}. Target: within 1 hour.`,
        action_url: `/dashboard/tickets/${ticketId}`,
        is_read: false,
        metadata: { ticket_id: ticketId, reason },
      }))
    );
    if (error) {
      if (error.code === '23514') console.warn(`${TAG} ticket_critical is not in the type CHECK — run migration 222`);
      else console.error(`${TAG} critical bell failed:`, error.message);
    }
  } catch (e) {
    console.error(`${TAG} critical bell failed:`, e);
  }
}

type MailKind = 'created' | 'waiting' | 'resolved';

/** The three ticket emails — SMTP-guarded, best-effort, recorded on the history with a MASKED recipient. */
async function sendTicketMail(admin: Admin, ticketId: string, kind: MailKind, replyBody?: string): Promise<void> {
  if (!SMTP_CONFIGURED()) return;
  try {
    const { data } = await admin.from('tickets').select(TICKET_COLUMNS).eq('id', ticketId).maybeSingle();
    const t = data as TicketRow | null;
    if (!t) return;
    const { recipientsFor } = await import('./mail');
    const recipients = await recipientsFor(admin, t);
    for (const to of recipients) {
      const sent =
        kind === 'created'
          ? await emailService.sendTicketCreated({ to, ticket: t })
          : kind === 'waiting'
            ? await emailService.sendTicketWaitingOnUser({ to, ticket: t, reply: replyBody ?? null })
            : await emailService.sendTicketResolved({ to, ticket: t });
      if (sent) await appendEvents(admin, [emailSentEvent(ticketId, kind, maskEmail(to))]);
    }
  } catch (e) {
    console.error(`${TAG} mail failed:`, e);
  }
}

export type { AdminPatch };
