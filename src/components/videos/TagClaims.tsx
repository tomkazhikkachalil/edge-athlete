'use client';

import { useCallback, useEffect, useState } from 'react';
import ConfirmModal from '@/components/ConfirmModal';
import { PersonPicker } from '@/components/videos/TagFields';
import { CLAIM_COPY, CLAIM_NAME_MAX, type ClaimTarget } from '@/lib/videos/tag-claims';
import type { TagCandidate, TagOwnerKind } from '@/lib/videos/tag-people';

const FIELD = 'w-full border border-border-strong rounded-lg px-3 min-h-[44px] text-base bg-surface text-primary';
const BTN = 'ea-interactive border border-border-strong text-secondary px-3 min-h-[44px] rounded-lg text-sm font-semibold disabled:opacity-60';
const CTA = 'ea-cta px-4 min-h-[44px] rounded-lg text-sm font-semibold text-white disabled:opacity-60';

interface Claim { id: string; asked_name: string | null; requester: { id: string; name: string; handle: string | null } }
type Loaded =
  | { can_manage: true; claims: Claim[]; targets: ClaimTarget[] }
  | { can_manage: false; mine: { id: string; status: 'pending' | 'approved' | 'declined'; asked_name: string | null } | null };

const targetValue = (t: ClaimTarget): string => (t.kind === 'placeholder' ? `p:${t.profile_id}` : `n:${t.name}`);
const targetBody = (t: ClaimTarget) => (t.kind === 'placeholder' ? { profile_id: t.profile_id } : { name: t.name });
const targetLabel = (t: ClaimTarget): string => `${t.name}${t.kind === 'placeholder' ? ' (no account)' : ' (typed name)'} · ${t.clips} ${t.clips === 1 ? 'clip' : 'clips'}`;

/**
 * "This is me" on a game (round 2 PR 4, Nov 13 2026). A signed-in viewer who
 * is not tagged asks to be linked; the video's managers see the open
 * requests and say which typed name or placeholder player each person is —
 * or link a name to a profile themselves. A request changes nothing until
 * it is approved. Props only; the parent refetches the video after a link.
 */
export default function TagClaims({ videoId, canManage, taggedMe, onLinked }: { videoId: string; canManage: boolean; taggedMe: boolean; onLinked: () => void }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [askedName, setAskedName] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [linkTarget, setLinkTarget] = useState('');
  const [picking, setPicking] = useState(false);
  const [confirm, setConfirm] = useState<{ target: ClaimTarget; to: { id: string; name: string } } | null>(null);
  const [known, setKnown] = useState<{ people: TagCandidate[]; ownerKind: TagOwnerKind }>({ people: [], ownerKind: 'org' });

  const load = useCallback(async (): Promise<Loaded | null> => {
    try {
      const res = await fetch(`/api/videos/${encodeURIComponent(videoId)}/claims`, { cache: 'no-store' });
      return res.ok ? ((await res.json()) as Loaded) : null;
    } catch {
      return null;
    }
  }, [videoId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next = await load();
      if (!cancelled) setData(next);
      if (!canManage) return;
      try {
        const res = await fetch(`/api/videos/${encodeURIComponent(videoId)}/people`, { cache: 'no-store' });
        if (!res.ok) return;
        const body = (await res.json()) as { people?: TagCandidate[]; owner_kind?: TagOwnerKind };
        if (!cancelled) setKnown({ people: body.people ?? [], ownerKind: body.owner_kind === 'profile' ? 'profile' : 'org' });
      } catch {
        /* the search still works */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load, canManage, videoId]);

  const send = async (path: string, method: 'POST' | 'PATCH', body: unknown): Promise<{ ok: boolean; body: Record<string, unknown> }> => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) setError(typeof parsed.error === 'string' ? parsed.error : 'That did not work. Try again.');
      return { ok: res.ok, body: parsed };
    } catch {
      setError('That did not work. Check your connection and try again.');
      return { ok: false, body: {} };
    } finally {
      setBusy(false);
    }
  };

  const linkedLine = (b: Record<string, unknown>): string => {
    const linked = Number(b.linked ?? 0);
    const videos = Number(b.videos ?? 0);
    return linked === 0 ? 'Nothing was linked: there were no tags to move.' : `Linked ${linked} ${linked === 1 ? 'tag' : 'tags'} in ${videos} ${videos === 1 ? 'game' : 'games'}.`;
  };

  const ask = async () => {
    const r = await send(`/api/videos/${encodeURIComponent(videoId)}/claims`, 'POST', askedName.trim() ? { name: askedName.trim() } : {});
    if (r.ok) setData(await load());
  };
  const decide = async (claim: Claim, action: 'approve' | 'decline', target?: ClaimTarget) => {
    const r = await send(`/api/videos/${encodeURIComponent(videoId)}/claims/${claim.id}`, 'PATCH', action === 'approve' && target ? { action, target: targetBody(target) } : { action });
    if (!r.ok) return;
    setNote(action === 'approve' ? linkedLine(r.body) : 'Declined.');
    setData(await load());
    if (action === 'approve') onLinked();
  };
  const link = async () => {
    if (!confirm) return;
    const { target, to } = confirm;
    setConfirm(null);
    const r = await send(`/api/videos/${encodeURIComponent(videoId)}/links`, 'POST', { target: targetBody(target), profile_id: to.id });
    if (!r.ok) return;
    setNote(linkedLine(r.body));
    setLinkTarget('');
    setData(await load());
    onLinked();
  };

  if (!data) return null;

  if (!data.can_manage) {
    if (taggedMe || data.mine?.status === 'approved') return null;
    return (
      <div className="bg-surface rounded-lg border border-border p-4 space-y-3" data-tag-claim={data.mine?.status ?? 'none'}>
        {data.mine?.status === 'pending' ? (
          <p className="text-sm text-secondary" role="status" data-tag-claim-pending="">{CLAIM_COPY.pending}</p>
        ) : (
          <>
            <div>
              <p className="text-sm font-semibold text-primary">{CLAIM_COPY.ask}</p>
              <p className="text-sm text-secondary">{CLAIM_COPY.askNote}</p>
              {data.mine?.status === 'declined' && <p className="text-xs text-muted mt-1" data-tag-claim-declined="">{CLAIM_COPY.declined}</p>}
            </div>
            <label className="block text-sm text-secondary">
              The name you are under in this game (optional)
              <input className={`${FIELD} mt-1`} maxLength={CLAIM_NAME_MAX} value={askedName} onChange={e => setAskedName(e.target.value)} autoComplete="off" data-tag-claim-name="" />
            </label>
            <button type="button" onClick={ask} disabled={busy} className={CTA} data-tag-claim-ask="">{busy ? 'Sending…' : 'Ask to be linked'}</button>
          </>
        )}
        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      </div>
    );
  }

  const { claims, targets } = data;
  if (claims.length === 0 && targets.length === 0 && !note) return null;
  const targetOf = (value: string) => targets.find(t => targetValue(t) === value) ?? null;
  const chosen = targetOf(linkTarget);
  return (
    <div className="bg-surface rounded-lg border border-border p-4 space-y-4" data-tag-claims={claims.length}>
      {claims.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-primary">Asking to be linked</p>
          {claims.map(c => {
            const picked = targetOf(choice[c.id] ?? '');
            return (
              <div key={c.id} className="rounded-lg border border-border-subtle p-3 space-y-2" data-tag-claim-row={c.requester.id}>
                <p className="text-sm text-primary break-words">
                  <span className="font-semibold">{c.requester.name}</span>
                  {c.requester.handle && <span className="text-muted"> @{c.requester.handle}</span>}
                  {c.asked_name && <span className="text-secondary"> — says they are “{c.asked_name}”</span>}
                </p>
                <label className="block text-xs text-muted">
                  Who they are in your tags
                  <select className={`${FIELD} mt-1`} value={choice[c.id] ?? ''} onChange={e => setChoice(prev => ({ ...prev, [c.id]: e.target.value }))} data-tag-claim-target="">
                    <option value="">Choose a name or player</option>
                    {targets.map(t => <option key={targetValue(t)} value={targetValue(t)}>{targetLabel(t)}</option>)}
                  </select>
                </label>
                <div className="flex flex-wrap gap-2 justify-end">
                  <button type="button" onClick={() => decide(c, 'decline')} disabled={busy} className={BTN} data-tag-claim-decline="">Decline</button>
                  <button type="button" onClick={() => picked && decide(c, 'approve', picked)} disabled={busy || !picked} className={CTA} data-tag-claim-approve="">Link them</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {targets.length > 0 && (
        <div className="space-y-2" data-tag-link="">
          <p className="text-sm font-semibold text-primary">Link a name to a profile</p>
          <p className="text-sm text-secondary">Someone tagged by name, or added without an account, who is on Edge Athlete: their clips and stats from your videos go on their profile.</p>
          <select className={FIELD} value={linkTarget} onChange={e => { setLinkTarget(e.target.value); setPicking(!!e.target.value); }} aria-label="The name or player to link" data-tag-link-target="">
            <option value="">Choose a name or player</option>
            {targets.map(t => <option key={targetValue(t)} value={targetValue(t)}>{targetLabel(t)}</option>)}
          </select>
          {chosen && picking && (
            <PersonPicker
              roleLabel={`${chosen.name} is`}
              taken={new Set(chosen.profile_id ? [`p:${chosen.profile_id}`] : [])}
              onPick={p => { if (p.profile_id) setConfirm({ target: chosen, to: { id: p.profile_id, name: p.name } }); setPicking(false); }}
              onClose={() => { setPicking(false); setLinkTarget(''); }}
              candidates={known.people.filter(p => p.id !== chosen.profile_id)}
              ownerKind={known.ownerKind}
              firstSide={null}
              sideNames={{ 1: 'Roster', 2: 'Roster' }}
              videoId={videoId}
              onCreated={() => undefined}
              linking
            />
          )}
        </div>
      )}
      {note && <p className="text-sm text-secondary" role="status" data-tag-claims-note="">{note}</p>}
      {error && <p className="text-sm text-red-600" role="alert" data-tag-claims-error="">{error}</p>}
      <ConfirmModal
        isOpen={!!confirm}
        title={confirm ? `Link “${confirm.target.name}” to ${confirm.to.name}?` : ''}
        message={confirm ? CLAIM_COPY.linkConfirm(confirm.target.name, confirm.to.name) : ''}
        confirmText="Link"
        onCancel={() => setConfirm(null)}
        onConfirm={link}
      />
    </div>
  );
}
