/**
 * The content snapshot (Support & Reporting, Spec 2) — server-only.
 *
 * A report is filed FROM the thing; the ticket keeps a copy of it AS IT WAS,
 * because the content may be edited or deleted before review. `resolveTarget`
 * answers the reported user, whether they are a minor (supervision — the
 * Critical rule), and the snapshot — or null when the reporter may not see
 * the thing (a 404, never a 403: existence is not disclosed).
 *
 * Each snapshot is a PROJECTION of the existing reader's shape: never an
 * email, never a supervision state, never a private field the reporter
 * could not see. Media are STORED paths (the admin page renders them through
 * toProxyUrl — the proxy's admin override applies); a DM thread keeps the
 * `deleted_at` redaction the messages reader applies. Names come through
 * publicDisplayName (a supervised or private person is masked here too).
 * A test serialises every shape and asserts the forbidden keys are absent.
 */
import type { getSupabaseAdmin } from '@/lib/auth-server';
import { canViewProfile } from '@/lib/privacy';
import { canViewSharedPost } from '@/lib/reposts';
import { publicDisplayName, type MaskableProfile } from '@/lib/orgs/public-names';
import type { TicketTargetType } from './types';
import { getOrgRole } from '@/lib/orgs/authz';
import type { OrgKind } from '@/lib/orgs/org-ref';
import { readSportEventAccess } from '@/lib/sport-events/access-server';

type Admin = ReturnType<typeof getSupabaseAdmin>;
const TAG = '[tickets snapshot]';
export const DM_SNAPSHOT_MESSAGES = 20;

export interface ResolvedTarget {
  type: TicketTargetType;
  id: string;
  profileId: string | null;
  isMinor: boolean;
  /** For a message target: the thread the freeze acts on. */
  conversationId: string | null;
  snapshot: Record<string, unknown>;
}

const PERSON_COLUMNS = 'id, first_name, last_name, full_name, handle, avatar_url, visibility, email, supervision_state, departed_at';

type PersonRow = MaskableProfile & { id: string; handle: string | null; avatar_url: string | null };

function person(p: PersonRow | null | undefined): { id: string; name: string; handle: string | null; avatar_url: string | null } | null {
  if (!p) return null;
  return { id: p.id, name: publicDisplayName(p), handle: p.handle ?? null, avatar_url: p.avatar_url ?? null };
}

async function readPerson(admin: Admin, id: string): Promise<PersonRow | null> {
  const { data } = await admin.from('profiles').select(PERSON_COLUMNS).eq('id', id).maybeSingle();
  return (data as PersonRow | null) ?? null;
}

async function isFollowing(admin: Admin, viewerId: string, profileId: string): Promise<boolean> {
  const { data } = await admin.from('follows').select('id').eq('follower_id', viewerId).eq('following_id', profileId).eq('status', 'accepted').maybeSingle();
  return !!data;
}

export async function resolveTarget(admin: Admin, viewerId: string, target: { type: TicketTargetType; id: string }): Promise<ResolvedTarget | null> {
  try {
    switch (target.type) {
      case 'post':
        return await resolvePost(admin, viewerId, target.id);
      case 'comment':
        return await resolveComment(admin, viewerId, target.id);
      case 'profile':
        return await resolveProfile(admin, viewerId, target.id);
      case 'conversation':
        return await resolveConversation(admin, viewerId, target.id, null);
      case 'message':
        return await resolveMessage(admin, viewerId, target.id);
      case 'org':
        return await resolveOrg(admin, viewerId, target.id);
      case 'sport_event':
        return await resolveSportEvent(admin, viewerId, target.id);
      default:
        return null;
    }
  } catch (e) {
    console.error(`${TAG} resolve failed:`, e);
    return null;
  }
}

async function resolvePost(admin: Admin, viewerId: string, postId: string): Promise<ResolvedTarget | null> {
  const { data: post } = await admin
    .from('posts')
    .select('id, profile_id, caption, sport_key, visibility, status, created_at, post_category, post_media(media_url, media_type, thumbnail_url, display_order)')
    .eq('id', postId)
    .maybeSingle();
  if (!post) return null;
  if (post.profile_id === viewerId) return null; // you cannot report yourself
  const author = await readPerson(admin, post.profile_id);
  if (!author) return null;
  const following = await isFollowing(admin, viewerId, post.profile_id);
  if (post.status !== 'published' && post.status !== 'hidden') return null;
  if (!canViewSharedPost({ postVisibility: post.visibility, ownerVisibility: author.visibility, isOwner: false, isFollower: following })) return null;
  const media = ((post.post_media as Array<{ media_url: string; media_type: string; thumbnail_url: string | null; display_order: number | null }>) ?? [])
    .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
    .map(m => ({ url: m.media_url, type: m.media_type, thumbnail_url: m.thumbnail_url }));
  return {
    type: 'post',
    id: post.id,
    profileId: post.profile_id,
    isMinor: author.supervision_state === 'supervised',
    conversationId: null,
    snapshot: {
      kind: 'post',
      post_id: post.id,
      author: person(author),
      caption: post.caption ?? null,
      sport_key: post.sport_key ?? null,
      post_category: post.post_category ?? null,
      visibility: post.visibility,
      media,
      created_at: post.created_at,
      captured_at: new Date().toISOString(),
    },
  };
}

async function resolveComment(admin: Admin, viewerId: string, commentId: string): Promise<ResolvedTarget | null> {
  const { data: c } = await admin
    .from('post_comments')
    .select('id, post_id, profile_id, content, gif_url, parent_comment_id, status, created_at')
    .eq('id', commentId)
    .maybeSingle();
  if (!c) return null;
  if (c.profile_id === viewerId) return null;
  if (c.status !== 'published' && c.status !== 'hidden') return null;
  // The comment is visible when its post is.
  const post = await resolvePost(admin, viewerId, c.post_id).catch(() => null);
  const { data: postRow } = await admin.from('posts').select('id, profile_id').eq('id', c.post_id).maybeSingle();
  if (!postRow) return null;
  if (!post && postRow.profile_id !== viewerId) return null; // neither visible to the reporter nor their own post
  const author = await readPerson(admin, c.profile_id);
  if (!author) return null;
  return {
    type: 'comment',
    id: c.id,
    profileId: c.profile_id,
    isMinor: author.supervision_state === 'supervised',
    conversationId: null,
    snapshot: {
      kind: 'comment',
      comment_id: c.id,
      post_id: c.post_id,
      parent_comment_id: c.parent_comment_id ?? null,
      author: person(author),
      content: c.content ?? null,
      gif_url: c.gif_url ?? null,
      created_at: c.created_at,
      captured_at: new Date().toISOString(),
    },
  };
}

async function resolveProfile(admin: Admin, viewerId: string, profileId: string): Promise<ResolvedTarget | null> {
  if (profileId === viewerId) return null;
  const { data: p } = await admin
    .from('profiles')
    .select(`${PERSON_COLUMNS}, bio, cover_url, sport, city, region, country, user_type`)
    .eq('id', profileId)
    .maybeSingle();
  if (!p) return null;
  // A private profile the reporter cannot open is still reportable by what they CAN see (the name card) —
  // the snapshot keeps only the public-card fields in that case.
  const access = await canViewProfile(profileId, viewerId);
  const row = p as PersonRow & { bio: string | null; cover_url: string | null; sport: string | null; city: string | null; region: string | null; country: string | null; user_type: string | null };
  return {
    type: 'profile',
    id: profileId,
    profileId,
    isMinor: row.supervision_state === 'supervised',
    conversationId: null,
    snapshot: {
      kind: 'profile',
      profile: person(row),
      visibility: row.visibility,
      user_type: row.user_type ?? null,
      ...(access.canView
        ? { bio: row.bio ?? null, cover_url: row.cover_url ?? null, sport: row.sport ?? null, location: [row.city, row.region, row.country].filter(Boolean).join(', ') || null }
        : { limited: true }),
      captured_at: new Date().toISOString(),
    },
  };
}

async function resolveConversation(admin: Admin, viewerId: string, conversationId: string, focusMessageId: string | null): Promise<ResolvedTarget | null> {
  const { data: me } = await admin
    .from('conversation_participants')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('profile_id', viewerId)
    .is('left_at', null)
    .maybeSingle();
  if (!me) return null;
  const { data: convo } = await admin.from('conversations').select('id, type, name').eq('id', conversationId).maybeSingle();
  if (!convo) return null;
  const { data: participants } = await admin
    .from('conversation_participants')
    .select(`profile_id, profile:profiles!conversation_participants_profile_id_fkey(${PERSON_COLUMNS})`)
    .eq('conversation_id', conversationId)
    .is('left_at', null);
  const people = (participants ?? []).map(r => {
    const raw = (r as { profile: unknown }).profile;
    return (Array.isArray(raw) ? raw[0] : raw) as PersonRow | null;
  });
  const others = people.filter((x): x is PersonRow => !!x && x.id !== viewerId);
  // The reported user of a DIRECT thread is the other participant; a group thread has no single subject
  // unless a message is the target (then its sender).
  const subject = convo.type === 'direct' && others.length === 1 ? others[0] : null;
  const { data: rows } = await admin
    .from('messages')
    .select('id, sender_id, type, content, media_url, media_type, shared_post_id, shared_profile_id, deleted_at, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(DM_SNAPSHOT_MESSAGES);
  const nameOf = new Map(people.filter((x): x is PersonRow => !!x).map(x => [x.id, publicDisplayName(x)]));
  const messages = (rows ?? []).reverse().map(m => ({
    id: m.id,
    sender_id: m.sender_id,
    sender: nameOf.get(m.sender_id) ?? 'Member',
    type: m.type,
    // The messages reader's redaction: a deleted row ships no content.
    content: m.deleted_at ? null : m.content,
    media_url: m.deleted_at ? null : m.media_url,
    media_type: m.deleted_at ? null : m.media_type,
    shared_post_id: m.deleted_at ? null : m.shared_post_id,
    shared_profile_id: m.deleted_at ? null : m.shared_profile_id,
    deleted: !!m.deleted_at,
    created_at: m.created_at,
    focus: focusMessageId === m.id,
  }));
  return {
    type: focusMessageId ? 'message' : 'conversation',
    id: focusMessageId ?? conversationId,
    profileId: subject?.id ?? null,
    isMinor: subject?.supervision_state === 'supervised',
    conversationId,
    snapshot: {
      kind: focusMessageId ? 'message' : 'conversation',
      conversation_id: conversationId,
      conversation_type: convo.type,
      participants: people.filter((x): x is PersonRow => !!x).map(person),
      subject: person(subject),
      messages,
      focus_message_id: focusMessageId,
      captured_at: new Date().toISOString(),
    },
  };
}

async function resolveMessage(admin: Admin, viewerId: string, messageId: string): Promise<ResolvedTarget | null> {
  const { data: m } = await admin.from('messages').select('id, conversation_id, sender_id').eq('id', messageId).maybeSingle();
  if (!m) return null;
  if (m.sender_id === viewerId) return null;
  const resolved = await resolveConversation(admin, viewerId, m.conversation_id, messageId);
  if (!resolved) return null;
  // A message names its sender as the reported user even in a group thread.
  const sender = await readPerson(admin, m.sender_id);
  return { ...resolved, profileId: m.sender_id, isMinor: sender?.supervision_state === 'supervised' };
}

// ── Authority (240): a club, league or its site; a sport event ─────────────
// The thing is reported, never a person: `profileId` is NULL, so an org or
// event report never counts toward anyone's strikes and never limits an
// account at intake. The reporter's OWN org or event is not reportable here
// (a 404 like any refusal) — its owners use the recovery request instead.

const SNAPSHOT_TEXT_MAX = 500;
const clip = (t: string | null | undefined) => (t ? (t.length > SNAPSHOT_TEXT_MAX ? `${t.slice(0, SNAPSHOT_TEXT_MAX)}…` : t) : null);

async function resolveOrg(admin: Admin, viewerId: string, orgId: string): Promise<ResolvedTarget | null> {
  const { data } = await admin.from('organizations').select('id, kind, name, description, visibility, city, region, country').eq('id', orgId).maybeSingle();
  const org = data as { id: string; kind: OrgKind; name: string; description: string | null; visibility: string | null; city: string | null; region: string | null; country: string | null } | null;
  if (!org) return null;
  const role = await getOrgRole(admin, org.kind, org.id, viewerId);
  if (role === 'owner' || role === 'manager') return null; // your own: the recovery request, not a report
  if (org.visibility === 'private' && !role) return null; // a private org a stranger cannot see
  const { data: siteRow } = await admin.from('org_sites').select('subdomain, published_at, published_revision_id, custom_domain').eq('org_id', org.id).maybeSingle();
  const site = siteRow as { subdomain: string; published_at: string | null; published_revision_id?: string | null; custom_domain: string | null } | null;
  return {
    type: 'org',
    id: org.id,
    profileId: null,
    isMinor: false,
    conversationId: null,
    snapshot: {
      kind: 'org',
      org_id: org.id,
      org_kind: org.kind,
      name: org.name,
      description: clip(org.description),
      visibility: org.visibility ?? 'public',
      location: [org.city, org.region, org.country].filter(Boolean).join(', ') || null,
      // The "restore to before" pointer: the version that was live when it was reported.
      site: site ? { subdomain: site.subdomain, live: !!site.published_at, published_revision_id: site.published_revision_id ?? null, custom_domain: site.custom_domain ?? null } : null,
      captured_at: new Date().toISOString(),
    },
  };
}

async function resolveSportEvent(admin: Admin, viewerId: string, eventId: string): Promise<ResolvedTarget | null> {
  const read = await readSportEventAccess(admin, eventId, viewerId, null);
  if (!read) return null; // not visible to the reporter
  if (read.event.host_profile_id === viewerId || read.access.canManage) return null; // your own
  const host = await readPerson(admin, read.event.host_profile_id);
  return {
    type: 'sport_event',
    id: read.event.id,
    profileId: null,
    isMinor: false,
    conversationId: null,
    snapshot: {
      kind: 'sport_event',
      event_id: read.event.id,
      name: read.event.name,
      description: clip(read.event.description),
      sport_key: read.event.sport_key,
      status: read.event.status,
      visibility: read.event.visibility,
      host: person(host),
      captured_at: new Date().toISOString(),
    },
  };
}
