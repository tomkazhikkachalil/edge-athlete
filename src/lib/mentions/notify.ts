// ── @mention notification fan-out ────────────────────────────────────────────
// Best-effort (a failed notification never fails the comment/message):
// direct inserts, the calendar/messages precedent — but 'mention' DOES have
// a preference (notification_preferences.mentions_enabled, default true),
// and create_notification is REVOKEd from route contexts, so the preference
// gate is replicated here: a MISSING preference row means allow.
//
// Gates, in order, for every recipient:
//   1. not the author,
//   2. mentions_enabled (missing row = true),
//   3. no user_blocks row in either direction (messages fan-out precedent),
//   4. caller-supplied visibility gate (comments: mentioned user can view
//      the post's owner via canViewProfile — never mint dead-link
//      notifications; chat: recipient is an active participant, checked by
//      the caller before it ever gets here).

import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

async function actorName(supabase: Admin, profileId: string): Promise<string> {
  const { data } = await supabase
    .from('profiles')
    .select('first_name, last_name, full_name')
    .eq('id', profileId)
    .maybeSingle();
  if (!data) return 'Someone';
  return (
    [data.first_name, data.last_name].filter(Boolean).join(' ') ||
    data.full_name ||
    'Someone'
  );
}

/** Recipients minus prefs-off and blocked pairs. */
async function filterNotifiable(
  supabase: Admin,
  actorId: string,
  recipientIds: string[]
): Promise<string[]> {
  const unique = [...new Set(recipientIds)].filter(id => id && id !== actorId);
  if (unique.length === 0) return [];

  const [{ data: prefRows }, { data: blockRows }] = await Promise.all([
    supabase
      .from('notification_preferences')
      .select('user_id, mentions_enabled')
      .in('user_id', unique),
    supabase
      .from('user_blocks')
      .select('blocker_id, blocked_id')
      .or(
        `and(blocked_id.eq.${actorId},blocker_id.in.(${unique.join(',')})),and(blocker_id.eq.${actorId},blocked_id.in.(${unique.join(',')}))`
      ),
  ]);

  const optedOut = new Set(
    (prefRows || []).filter(p => p.mentions_enabled === false).map(p => p.user_id)
  );
  const blocked = new Set(
    (blockRows || []).flatMap(b => [b.blocker_id, b.blocked_id]).filter(id => id !== actorId)
  );
  return unique.filter(id => !optedOut.has(id) && !blocked.has(id));
}

export async function notifyCommentMentions(
  supabase: Admin,
  args: {
    postId: string;
    commentId: string;
    authorId: string;
    /** Already visibility-gated by the caller (canViewProfile per recipient). */
    mentionedIds: string[];
    content: string | null;
  }
): Promise<void> {
  try {
    const recipients = await filterNotifiable(supabase, args.authorId, args.mentionedIds);
    if (recipients.length === 0) return;
    const name = await actorName(supabase, args.authorId);
    const rows = recipients.map(id => ({
      user_id: id,
      type: 'mention',
      actor_id: args.authorId,
      title: `${name} mentioned you in a comment`,
      message: args.content ? args.content.slice(0, 80) : null,
      action_url: `/feed?post=${args.postId}`,
      is_read: false,
      metadata: { post_id: args.postId, comment_id: args.commentId },
    }));
    const { error } = await supabase.from('notifications').insert(rows);
    if (error) console.error('[MENTIONS] comment fan-out failed:', error);
  } catch (e) {
    console.error('[MENTIONS] comment fan-out failed:', e);
  }
}

export async function notifyChatMentions(
  supabase: Admin,
  args: {
    conversationId: string;
    messageId: string;
    senderId: string;
    /** ACTIVE participants whose handles were @'d — caller matches tokens. */
    mentionedIds: string[];
  }
): Promise<void> {
  try {
    const recipients = await filterNotifiable(supabase, args.senderId, args.mentionedIds);
    if (recipients.length === 0) return;
    const name = await actorName(supabase, args.senderId);
    const rows = recipients.map(id => ({
      user_id: id,
      type: 'mention',
      actor_id: args.senderId,
      title: `${name} mentioned you`,
      message: null,
      action_url: `/messages?c=${args.conversationId}`,
      is_read: false,
      metadata: { conversation_id: args.conversationId, message_id: args.messageId },
    }));
    const { error } = await supabase.from('notifications').insert(rows);
    if (error) console.error('[MENTIONS] chat fan-out failed:', error);
  } catch (e) {
    console.error('[MENTIONS] chat fan-out failed:', e);
  }
}
