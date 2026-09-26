'use client';

/**
 * The content snapshot, rendered per kind for the admin (Support &
 * Reporting, Spec 2). The snapshot holds STORED media paths; they are shown
 * through the media proxy (`/api/media/…` — the proxy's admin override lets
 * a moderator view reported media). A DM thread renders its last 20
 * messages with the deleted ones redacted, the focused one marked.
 */
import { toProxyUrl } from '@/lib/media/proxy-url';

type Person = { id: string; name: string; handle: string | null; avatar_url: string | null } | null;

interface PostSnapshot {
  kind: 'post';
  post_id: string;
  author: Person;
  caption: string | null;
  sport_key: string | null;
  visibility: string;
  media: Array<{ url: string; type: string; thumbnail_url: string | null }>;
  created_at: string;
}
interface CommentSnapshot {
  kind: 'comment';
  comment_id: string;
  post_id: string;
  author: Person;
  content: string | null;
  gif_url: string | null;
  created_at: string;
}
interface ProfileSnapshot {
  kind: 'profile';
  profile: Person;
  visibility: string | null;
  user_type: string | null;
  bio?: string | null;
  sport?: string | null;
  location?: string | null;
  limited?: boolean;
}
interface ThreadSnapshot {
  kind: 'conversation' | 'message';
  conversation_id: string;
  conversation_type: string;
  participants: Person[];
  subject: Person;
  messages: Array<{ id: string; sender: string; type: string; content: string | null; media_url: string | null; deleted: boolean; created_at: string; focus: boolean }>;
}
// Authority (240): the thing reported is an org (club / league / its site) or a sport event.
interface OrgSnapshot {
  kind: 'org';
  org_id: string;
  org_kind: string;
  name: string;
  description: string | null;
  visibility: string;
  location: string | null;
  site: { subdomain: string; live: boolean; published_revision_id: string | null; custom_domain: string | null } | null;
}
interface EventSnapshot {
  kind: 'sport_event';
  event_id: string;
  name: string;
  description: string | null;
  sport_key: string;
  status: string;
  visibility: string;
  host: Person;
  reporter_result?: { participant_id: string; status: string; rounds: Array<{ sequence: number; gross: number | null; holes: number | null; stats: Record<string, number> | null }> };
}
type Snapshot = PostSnapshot | CommentSnapshot | ProfileSnapshot | ThreadSnapshot | OrgSnapshot | EventSnapshot;
const KINDS = new Set(['post', 'comment', 'profile', 'conversation', 'message', 'org', 'sport_event']);

function Who({ p }: { p: Person }) {
  if (!p) return <span className="text-muted">Unknown</span>;
  return (
    <span className="text-primary font-medium">
      {p.name}
      {p.handle ? <span className="text-muted font-normal"> @{p.handle}</span> : null}
    </span>
  );
}

export default function SnapshotView({ snapshot, targetId }: { snapshot: Record<string, unknown>; targetId: string | null }) {
  if (snapshot.anonymized === true) return <p className="text-sm text-muted">Anonymized by retention.</p>;
  if (typeof snapshot.kind !== 'string' || !KINDS.has(snapshot.kind)) {
    return <pre className="text-xs bg-surface-muted rounded-lg p-3 overflow-x-auto">{JSON.stringify(snapshot, null, 2)}</pre>;
  }
  const s = snapshot as unknown as Snapshot;

  if (s.kind === 'post') {
    const media = s.media ?? [];
    return (
      <div className="space-y-2" data-snapshot-kind="post">
        <p className="text-xs text-muted">Post by <Who p={s.author} /> · {new Date(s.created_at).toLocaleString()} · {s.visibility}{s.sport_key ? ` · ${s.sport_key}` : ''}</p>
        {s.caption && <p className="text-sm text-primary whitespace-pre-wrap">{s.caption}</p>}
        {media.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {media.map((m, i) => (
              <a key={i} href={toProxyUrl(m.url, { type: 'post', id: targetId ?? s.post_id }) ?? '#'} target="_blank" rel="noreferrer" className="block w-24 h-24 rounded-lg overflow-hidden bg-surface-muted border border-border">
                {m.type === 'video' ? (
                  <span className="w-full h-full flex items-center justify-center text-xs text-muted">video</span>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element -- a proxied, admin-only evidence thumbnail; not an optimizer candidate
                  <img src={toProxyUrl(m.thumbnail_url ?? m.url, { type: 'post', id: targetId ?? s.post_id }) ?? ''} alt="" className="w-full h-full object-cover" />
                )}
              </a>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (s.kind === 'comment') {
    return (
      <div className="space-y-1" data-snapshot-kind="comment">
        <p className="text-xs text-muted">Comment by <Who p={s.author} /> · {new Date(s.created_at).toLocaleString()}</p>
        {s.content && <p className="text-sm text-primary whitespace-pre-wrap">{s.content}</p>}
        {s.gif_url && <p className="text-xs text-muted">GIF: {s.gif_url}</p>}
        <a href={`/feed?post=${s.post_id}`} className="text-xs text-brand-fg hover:underline">Open the post</a>
      </div>
    );
  }

  if (s.kind === 'profile') {
    return (
      <div className="space-y-1" data-snapshot-kind="profile">
        <p className="text-sm"><Who p={s.profile} /> <span className="text-xs text-muted">· {s.visibility ?? '—'} · {s.user_type ?? 'athlete'}</span></p>
        {s.limited ? <p className="text-xs text-muted">Private profile — the reporter saw the name card only.</p> : (
          <>
            {s.bio && <p className="text-sm text-primary whitespace-pre-wrap">{s.bio}</p>}
            <p className="text-xs text-muted">{[s.sport, s.location].filter(Boolean).join(' · ')}</p>
          </>
        )}
      </div>
    );
  }

  if (s.kind === 'org') {
    return (
      <div className="space-y-1" data-snapshot-kind="org">
        <p className="text-sm text-primary font-medium">{s.name} <span className="text-xs text-muted">· {s.org_kind} · {s.visibility}{s.location ? ` · ${s.location}` : ''}</span></p>
        {s.description && <p className="text-sm text-primary whitespace-pre-wrap">{s.description}</p>}
        {s.site && <p className="text-xs text-muted">Site /org/{s.site.subdomain}{s.site.custom_domain ? ` · ${s.site.custom_domain}` : ''} · {s.site.live ? 'live' : 'offline'} when reported{s.site.published_revision_id ? ' — the version live then is in its history' : ''}</p>}
        <a href={`/dashboard/recovery/org/${s.org_id}`} className="text-xs text-brand-fg hover:underline">Open the recovery panel</a>
      </div>
    );
  }

  if (s.kind === 'sport_event') {
    return (
      <div className="space-y-1" data-snapshot-kind="sport_event">
        <p className="text-sm text-primary font-medium">{s.name} <span className="text-xs text-muted">· {s.sport_key} · {s.status} · {s.visibility}</span></p>
        <p className="text-xs text-muted">Hosted by <Who p={s.host} /></p>
        {s.description && <p className="text-sm text-primary whitespace-pre-wrap">{s.description}</p>}
        {s.reporter_result && (
          <p className="text-xs text-secondary" data-snapshot-reporter-result="">
            The reporter&apos;s result as recorded: {s.reporter_result.rounds.map(r => `R${r.sequence} ${r.gross != null ? `${r.gross} (${r.holes ?? '?'} holes)` : r.stats ? Object.entries(r.stats).map(([k, v]) => `${k} ${v}`).join(', ') : '—'}`).join(' · ') || 'no rounds'}
          </p>
        )}
        <a href={`/dashboard/recovery/event/${s.event_id}`} className="text-xs text-brand-fg hover:underline">Open the recovery panel</a>
      </div>
    );
  }

  if (s.kind === 'conversation' || s.kind === 'message') {
    return (
      <div className="space-y-2" data-snapshot-kind={s.kind}>
        <p className="text-xs text-muted">
          {s.conversation_type === 'direct' ? 'Direct thread' : 'Group thread'} · {s.participants.map(p => p?.name ?? '?').join(', ')}
          {s.subject ? <> · reported: <Who p={s.subject} /></> : null}
        </p>
        <ol className="space-y-1 max-h-80 overflow-y-auto pr-1">
          {s.messages.map(m => (
            <li key={m.id} className={`text-sm rounded-lg px-3 py-1.5 ${m.focus ? 'bg-amber-50 dark:bg-amber-950/30 border border-amber-300' : 'bg-surface-muted'}`} data-snapshot-focus={m.focus ? '' : undefined}>
              <span className="text-xs text-muted">{m.sender} · {new Date(m.created_at).toLocaleTimeString()}</span>
              <p className="text-primary whitespace-pre-wrap">{m.deleted ? <em className="text-muted">deleted before the report</em> : m.content ?? (m.media_url ? '[media]' : `[${m.type}]`)}</p>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return null;
}
