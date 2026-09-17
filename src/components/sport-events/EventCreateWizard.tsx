'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import ConfirmModal from '@/components/ConfirmModal';
import { useDirtyClose } from '@/hooks/useDirtyClose';
import { useAuth } from '@/lib/auth';
import { COPY } from '@/lib/copy';
import { SPORT_EVENT_SPORTS_ALL, type SportEventSport } from '@/lib/sport-events/types';
import { formatDateOnly, formatLabel, holesLabel, joinLine, MATCH_SIDES_LABEL, roundsSummary, VISIBILITY_LABEL } from '@/lib/sport-events/format';
import { isMatchFormat, MATCH_SIDES } from '@/lib/sport-events/types';
import { MAX_ROUNDS } from '@/lib/sport-events/rounds';
import { addWizardRound, emptyWizardState, isWizardDirty, removeWizardRound, updateWizardRound, validateWizardStep, wizardToCreateBody, WIZARD_STEP_LABEL, WIZARD_STEPS, type WizardState, type WizardStep , withVisibility, withSport, withSideTeam } from '@/lib/sport-events/wizard';
import { eligibleCompetition, type CompetitionForLink } from '@/lib/sport-events/contest-link';
import RoundFields, { Choice } from './RoundFields';
import GameFields from './GameFields';
import { getEnabledSports } from '@/lib/sports/SportRegistry';
import { RECORDING_MODE_LABEL } from '@/lib/sport-events/recording';

/**
 * The creation wizard (Events program): basics → round → format → review,
 * the OrgStartWizard shape — one step on screen, Step n of 4, Back, a
 * refusal in the copy the rules answer, Publish or Save draft on the
 * review, then straight to the event's place. Cancel and Back-out-of-step-1
 * ask before discarding (useDirtyClose + ConfirmModal). Single column,
 * 44px controls, a sticky footer with the safe-area inset.
 */
interface ManagedOrg { kind: 'club' | 'league'; id: string; name: string; role: string }

const INPUT = 'w-full min-h-[44px] px-3 rounded-lg border border-border-strong bg-surface text-primary text-base';
const PRIMARY = 'ea-cta text-white px-5 min-h-[44px] rounded-lg text-sm font-semibold inline-flex items-center justify-center disabled:opacity-60';
const SECONDARY = 'ea-interactive border border-border-strong text-secondary px-4 min-h-[44px] rounded-lg text-sm font-semibold inline-flex items-center justify-center disabled:opacity-60';

export default function EventCreateWizard() {
  const router = useRouter();
  const { user, activeProfile } = useAuth();
  const [s, setS] = useState<WizardState>(emptyWizardState);
  const [joinTouched, setJoinTouched] = useState(false);
  const [step, setStep] = useState<WizardStep>('basics');
  const [refusal, setRefusal] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orgs, setOrgs] = useState<ManagedOrg[]>([]);
  const submittingRef = useRef(false);
  // Phase 4 (215): every event sport — golf, and the stat-line team sports.
  const sports = getEnabledSports().filter(sp => (SPORT_EVENT_SPORTS_ALL as readonly string[]).includes(sp.sport_key));
  const team = s.sport_key !== 'golf';
  const sportName = sports.find(sp => sp.sport_key === s.sport_key)?.display_name ?? s.sport_key;

  const { requestClose, confirmOpen, confirmDiscard, cancelDiscard } = useDirtyClose(() => isWizardDirty(s), () => router.push('/feed'));

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/profile/${user.id}/organizations`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const all = (data.organizations ?? []) as ManagedOrg[];
        setOrgs(all.filter(o => ['owner', 'manager', 'admin', 'staff'].includes(o.role)));
      } catch { /* no org select */ }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  const set = <K extends keyof WizardState>(key: K, value: WizardState[K]) => setS(prev => ({ ...prev, [key]: value }));

  // Phase 2b: the chosen org's eligible competitions ("Counts toward") — the
  // fetched list is keyed by the org, so a switch DERIVES an empty list (no
  // setState in the effect) until the new org's answer lands.
  const [fetched, setFetched] = useState<{ key: string; list: CompetitionForLink[] } | null>(null);
  const orgKey = s.org ? `${s.org.kind}:${s.org.id}` : '';
  const competitions = fetched && fetched.key === orgKey ? fetched.list : [];
  useEffect(() => {
    if (!orgKey) return;
    const [kind, id] = orgKey.split(':') as ['club' | 'league', string];
    let cancelled = false;
    (async () => {
      let list: CompetitionForLink[] = [];
      try {
        const res = await fetch(`/api/${kind}s/${id}/competitions`, { cache: 'no-store' });
        if (res.ok) {
          const data = (await res.json()) as { competitions?: CompetitionForLink[] };
          const ev = { club_id: kind === 'club' ? id : null, league_id: kind === 'league' ? id : null };
          list = (data.competitions ?? []).map(c => ({ ...c, ...ev })).filter(c => eligibleCompetition(ev, c));
        }
      } catch { /* no picker */ }
      if (!cancelled) setFetched({ key: orgKey, list });
    })();
    return () => { cancelled = true; };
  }, [orgKey]);
  // Leftovers PR 5: the chosen org's teams pre-fill a game's sides — keyed by the org like the competitions.
  const [fetchedTeams, setFetchedTeams] = useState<{ key: string; list: Array<{ id: string; name: string; display_name: string | null }> } | null>(null);
  const orgTeams = fetchedTeams && fetchedTeams.key === orgKey ? fetchedTeams.list : [];
  useEffect(() => {
    if (!orgKey || !team || s.shape !== 'game') return;
    const [kind, id] = orgKey.split(':') as ['club' | 'league', string];
    let cancelled = false;
    (async () => {
      let list: Array<{ id: string; name: string; display_name: string | null }> = [];
      try {
        const res = await fetch(`/api/${kind}s/${id}/structure`, { cache: 'no-store' });
        if (res.ok) {
          const data = (await res.json()) as { teams?: Array<{ id: string; name: string; display_name?: string | null; status?: string }> };
          list = (data.teams ?? []).filter(t => t.status !== 'archived').map(t => ({ id: t.id, name: t.name, display_name: t.display_name ?? null }));
        }
      } catch { /* the picks stay off */ }
      if (!cancelled) setFetchedTeams({ key: orgKey, list });
    })();
    return () => { cancelled = true; };
  }, [orgKey, team, s.shape]);
  const stepIndex = WIZARD_STEPS.indexOf(step);
  const next = () => {
    const r = validateWizardStep(step, s);
    setRefusal(r);
    if (r) return;
    setStep(WIZARD_STEPS[Math.min(WIZARD_STEPS.length - 1, stepIndex + 1)]);
  };
  const back = () => { setRefusal(null); setStep(WIZARD_STEPS[Math.max(0, stepIndex - 1)]); };

  const submit = async (publish: boolean) => {
    if (submittingRef.current) return;
    const r = validateWizardStep('review', s);
    setRefusal(r);
    if (r) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/sport-events', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(wizardToCreateBody(s, { publish, profileId: activeProfile?.id ?? null })) });
      const data = (await res.json().catch(() => ({}))) as { error?: string; event?: { id: string } };
      if (!res.ok || !data.event) { setError(data.error ?? 'Could not create the event.'); return; }
      // A successful save never asks to discard: leave through the router directly.
      router.push(`/events/${data.event.id}`);
    } catch {
      setError('Could not create the event.');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const orgLabel = s.org ? orgs.find(o => o.kind === s.org?.kind && o.id === s.org?.id)?.name ?? 'Organization' : null;
  // Phase 4: a team event's review — the sport, the kind, the place and start, the sides; no golf rows.
  const teamReviewRows: string[][] = [
    ['Name', s.name.trim()],
    ['Sport', sportName],
    ['Kind', s.shape === 'game' ? 'A game' : 'A session'],
    ...(s.rounds.length > 1
      ? [['Rounds', roundsSummary(s.rounds.map((r, i) => ({ sequence: i + 1, scheduled_on: r.scheduled_on, status: 'scheduled' })))], ...s.rounds.map((r, i) => [`Round ${i + 1}`, `${formatDateOnly(r.scheduled_on)} · ${r.place.trim()}${r.starts_at.trim() ? ` · ${r.starts_at.trim()}` : ''}`])]
      : [['Date', formatDateOnly(s.rounds[0].scheduled_on, { weekday: true })], ['Where', s.rounds[0].place.trim()], ...(s.rounds[0].starts_at.trim() ? [['Start', s.rounds[0].starts_at.trim()]] : [])]),
    ...(s.shape === 'game' ? [['Sides', `${s.side_names[0].trim()} vs ${s.side_names[1].trim()}`]] : []),
    ['Who can see it', VISIBILITY_LABEL[s.visibility]],
    ['Joining', joinLine(s.join_mode)],
    ['Field size', s.capacity.trim() ? `${s.capacity} players` : 'No limit'],
    ...(orgLabel ? [['Hosted for', orgLabel]] : []),
    ['Recording', RECORDING_MODE_LABEL[s.recording]],
    ['You', s.host_plays ? 'Playing' : 'Organizing only'],
  ];

  return (
    <div className="bg-surface rounded-xl shadow-sm border border-border p-4 sm:p-6 space-y-5" data-event-wizard={step}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold text-tertiary uppercase tracking-wide">Step {stepIndex + 1} of {WIZARD_STEPS.length} · {WIZARD_STEP_LABEL[step]}</p>
        <button type="button" onClick={requestClose} className="text-sm text-secondary hover:text-primary min-h-[44px] px-2" data-event-wizard-cancel="">Cancel</button>
      </div>

      {step === 'basics' && (
        <div className="space-y-4">
          <h1 className="text-h3 font-bold text-primary">Create an event</h1>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-secondary">Name</span>
            <input value={s.name} onChange={e => set('name', e.target.value)} maxLength={120} className={INPUT} placeholder="Saturday Skins at Eagle Creek" data-event-wizard-name="" />
          </label>
          {sports.length > 1 && (
            <div className="space-y-1" data-wizard-sport="">
              <span className="text-sm font-medium text-secondary">Sport</span>
              <Choice name="Sport" value={s.sport_key} onChange={v => { setRefusal(null); setS(prev => withSport(prev, v)); }} options={sports.map(sp => ({ value: sp.sport_key as SportEventSport, label: sp.display_name }))} />
            </div>
          )}
          {team && (
            <div className="space-y-1" data-wizard-shape="">
              <span className="text-sm font-medium text-secondary">What kind of event</span>
              <Choice name="Kind" value={s.shape as 'game' | 'session'} onChange={v => set('shape', v)} options={[
                { value: 'game', label: 'A game', hint: 'Two sides from the players who join, a live score and everyone\'s stats.' },
                { value: 'session', label: 'A session', hint: 'One roster — a practice, a scrimmage, a pickup run — with everyone\'s stats.' },
              ]} />
            </div>
          )}
          <label className="block space-y-1">
            <span className="text-sm font-medium text-secondary">Description <span className="text-muted font-normal">(optional)</span></span>
            <textarea value={s.description} onChange={e => set('description', e.target.value)} rows={3} maxLength={2000} className={`${INPUT} py-2`} placeholder="Format, stakes, what to bring…" />
          </label>
          {orgs.length > 0 && (
            <label className="block space-y-1">
              <span className="text-sm font-medium text-secondary">Hosted for <span className="text-muted font-normal">(optional)</span></span>
              <select value={s.org ? `${s.org.kind}:${s.org.id}` : ''} onChange={e => { const v = e.target.value; setS(prev => ({ ...prev, org: v ? { kind: v.split(':')[0] as 'club' | 'league', id: v.split(':')[1] } : null, competition: null })); }} className={INPUT}>
                <option value="">Just me</option>
                {orgs.map(o => <option key={`${o.kind}:${o.id}`} value={`${o.kind}:${o.id}`}>{o.name}</option>)}
              </select>
            </label>
          )}
          {s.org && competitions.length > 0 && (
            <label className="block space-y-1">
              <span className="text-sm font-medium text-secondary">Counts toward <span className="text-muted font-normal">(optional)</span></span>
              <select value={s.competition ?? ''} onChange={e => set('competition', e.target.value || null)} className={INPUT} data-event-wizard-competition="">
                <option value="">Just an event</option>
                {competitions.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <span className="block text-xs text-muted">One contest per round on the competition; the org&apos;s results come from the leaderboard.</span>
            </label>
          )}
          <div className="space-y-1">
            <span className="text-sm font-medium text-secondary">Who can see it</span>
            <Choice name="Visibility" value={s.visibility} onChange={v => { setRefusal(null); setS(prev => withVisibility(prev, v, joinTouched)); }} options={[
              { value: 'public', label: 'Public', hint: 'Anyone can find it and watch — the scores, the players, everything. The default.' },
              { value: 'link', label: 'Anyone with the link', hint: 'You get a link to share.' },
              { value: 'private', label: 'Private', hint: 'Only people you invite, and followers of the event.' },
            ]} />
          </div>
          <div className="space-y-1">
            <span className="text-sm font-medium text-secondary">Joining</span>
            <Choice name="Joining" value={s.join_mode} onChange={v => { setJoinTouched(true); set('join_mode', v); }} options={[
              { value: 'open', label: 'Open to everyone', hint: 'Anyone with an account joins with one tap. A field size still waitlists.' },
              { value: 'request', label: 'Open to requests', hint: 'Players ask; you approve. Invites still work.' },
              { value: 'invite', label: 'Invite only', hint: 'You add every player.' },
            ]} />
          </div>
        </div>
      )}

      {step === 'round' && (
        <div className="space-y-5">
          <h2 className="text-h3 font-bold text-primary">{s.rounds.length > 1 ? 'The rounds' : team ? (s.shape === 'game' ? 'The game' : 'The session') : 'The round'}</h2>
          {s.rounds.map((r, i) => (
            <section key={i} className={s.rounds.length > 1 ? 'bg-surface-muted rounded-lg p-4 space-y-4' : 'space-y-4'} data-wizard-round={i + 1}>
              {s.rounds.length > 1 && (
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-bold text-primary">Round {i + 1}</h3>
                  {i > 0 && <button type="button" onClick={() => { setRefusal(null); setS(prev => removeWizardRound(prev, i)); }} className="text-sm text-secondary hover:text-primary min-h-[44px] px-2" data-wizard-round-remove={i + 1}>Remove</button>}
                </div>
              )}
              {team
                ? <GameFields value={r} onChange={patch => setS(prev => updateWizardRound(prev, i, patch))} idPrefix={`event-wizard-round-${i + 1}`} />
                : <RoundFields value={r} onChange={patch => setS(prev => updateWizardRound(prev, i, patch))} idPrefix={`event-wizard-round-${i + 1}`} />}
            </section>
          ))}
          {s.rounds.length < MAX_ROUNDS && (
            <button type="button" onClick={() => { setRefusal(null); setS(prev => addWizardRound(prev)); }} className={SECONDARY} data-wizard-add-round=""><i className="fas fa-plus mr-2" aria-hidden="true"></i>Add a round</button>
          )}
          {s.rounds.length > 1 && <p className="text-xs text-muted">Rounds run in date order, one at a time. You start each one from the event page on its day.</p>}
        </div>
      )}

      {step === 'format' && (
        <div className="space-y-4">
          <h2 className="text-h3 font-bold text-primary">{team ? 'Details' : 'Format'}</h2>
          {!team && (<>
          <Choice name="Format" value={s.format} onChange={v => set('format', v)} options={[
            { value: 'stroke_gross', label: 'Stroke play · Gross', hint: 'Lowest total wins.' },
            { value: 'stroke_net', label: 'Stroke play · Net', hint: 'Each player\'s Edge Athlete index is frozen when they accept; you can set one by hand.' },
            { value: 'match_gross', label: 'Match play · Gross', hint: 'Two sides a group; a hole won, lost or halved. You set every draw.' },
            { value: 'match_net', label: 'Match play · Net', hint: 'Strokes given by the difference in playing handicaps, on the stroke index.' },
          ]} />
          {isMatchFormat(s.format) && (
            <div className="space-y-3" data-wizard-match="">
              <Choice name="Sides" value={s.match.sides} onChange={v => set('match', { ...s.match, sides: v })} options={MATCH_SIDES.map(k => ({
                value: k,
                label: MATCH_SIDES_LABEL[k],
                hint: k === 'singles' ? 'One against one.' : k === 'fourball' ? 'Two a side, the better ball counts.' : 'Two a side, one ball — the captain keeps the card.',
              }))} />
              <label className="flex items-center gap-3 min-h-[44px]">
                <input type="checkbox" checked={s.match.bracket} onChange={e => set('match', { ...s.match, bracket: e.target.checked })} className="h-4 w-4" data-wizard-bracket="" />
                <span className="text-sm text-primary">A knockout bracket — the rounds are its rounds; winners go through</span>
              </label>
              {s.match.bracket && s.rounds.length < 2 && <p className="text-xs text-muted">A bracket needs at least two rounds — go back and add them.</p>}
              <p className="text-xs text-muted">A halved match goes to sudden-death extra holes. Every match round posts to each player&apos;s profile and handicap as played.</p>
            </div>
          )}
          </>)}
          {team && s.shape === 'game' && (
            <div className="space-y-2" data-wizard-sides="">
              <span className="block text-sm font-medium text-secondary">The two sides</span>
              {s.org && orgTeams.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  {([0, 1] as const).map(i => (
                    <select key={i} value={s.side_teams[i] ?? ''} onChange={e => { const t = orgTeams.find(x => x.id === e.target.value) ?? null; setRefusal(null); setS(prev => withSideTeam(prev, i, t ? { id: t.id, name: t.display_name || t.name } : null)); }} className={INPUT} aria-label={`Side ${i + 1} team`} data-wizard-side-team={i + 1}>
                      <option value="">Pick a team…</option>
                      {orgTeams.map(t => <option key={t.id} value={t.id}>{t.display_name || t.name}</option>)}
                    </select>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <input value={s.side_names[0]} onChange={e => set('side_names', [e.target.value, s.side_names[1]])} maxLength={40} className={INPUT} aria-label="Side 1 name" data-wizard-side="1" />
                <input value={s.side_names[1]} onChange={e => set('side_names', [s.side_names[0], e.target.value])} maxLength={40} className={INPUT} aria-label="Side 2 name" data-wizard-side="2" />
              </div>
              <span className="block text-xs text-muted">{s.org && orgTeams.length > 0 ? 'Pick two of the organization’s teams and their rosters become the sides — or type the names and sort the players from the Groups tab once they’ve joined.' : 'Players are sorted into the sides from the Groups tab once they’ve joined.'}</span>
            </div>
          )}
          <label className="block space-y-1">
            <span className="text-sm font-medium text-secondary">Field size <span className="text-muted font-normal">(optional)</span></span>
            <input type="number" inputMode="numeric" min={1} max={500} value={s.capacity} onChange={e => set('capacity', e.target.value)} className={INPUT} placeholder="No limit" />
            <span className="text-xs text-muted">Players past the limit go on a waitlist and move up when a spot opens.</span>
          </label>
          <div className="space-y-2" data-wizard-recording="">
            <span className="block text-sm font-medium text-secondary">Who enters the scores</span>
            <Choice name="Recording" value={s.recording} onChange={v => set('recording', v)} options={[
              { value: 'self', label: 'Players enter their own', hint: 'Each player scores their card; group partners may help.' },
              { value: 'both', label: 'Players and recorders', hint: 'Players score their own; recorders you name may enter for anyone.' },
              { value: 'recorder', label: 'Recorders only', hint: 'Only recorders you name (and organizers) enter scores — name them on the Players tab.' },
            ]} />
          </div>
          <label className="flex items-center gap-3 min-h-[44px]">
            <input type="checkbox" checked={s.host_plays} onChange={e => set('host_plays', e.target.checked)} className="h-4 w-4" />
            <span className="text-sm text-primary">I&apos;m playing too</span>
          </label>
        </div>
      )}

      {step === 'review' && (
        <div className="space-y-4">
          <h2 className="text-h3 font-bold text-primary">Review</h2>
          <dl className="bg-surface-muted rounded-lg px-4 py-1 text-sm">
            {(team ? teamReviewRows : [
              ['Name', s.name.trim()],
              ...(s.rounds.length > 1
                ? [['Rounds', roundsSummary(s.rounds.map((r, i) => ({ sequence: i + 1, scheduled_on: r.scheduled_on, status: 'scheduled' })))], ...s.rounds.map((r, i) => [`Round ${i + 1}`, `${formatDateOnly(r.scheduled_on)} · ${r.course?.name ?? ''}${r.tee ? ` · ${r.tee} tees` : ''} · ${holesLabel(r.holes, r.holes === 9 ? r.starting_hole : 1)}`])]
                : [
                  ['Date', formatDateOnly(s.rounds[0].scheduled_on, { weekday: true })],
                  ['Course', `${s.rounds[0].course?.name ?? ''}${s.rounds[0].tee ? ` · ${s.rounds[0].tee} tees` : ''}`],
                  ['Holes', holesLabel(s.rounds[0].holes, s.rounds[0].holes === 9 ? s.rounds[0].starting_hole : 1)],
                ]),
              ['Format', formatLabel(s.format, isMatchFormat(s.format) ? s.match : null)],
              ['Who can see it', VISIBILITY_LABEL[s.visibility]],
              ['Joining', joinLine(s.join_mode)],
              ['Field size', s.capacity.trim() ? `${s.capacity} players` : 'No limit'],
              ...(orgLabel ? [['Hosted for', orgLabel]] : []),
              ...(s.competition ? [['Counts toward', competitions.find(c => c.id === s.competition)?.name ?? 'Competition']] : []),
              ['Recording', RECORDING_MODE_LABEL[s.recording]],
              ['You', s.host_plays ? 'Playing' : 'Organizing only'],
            ]).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 py-2 border-b border-border-subtle last:border-b-0"><dt className="text-muted">{k}</dt><dd className="text-primary text-right">{v}</dd></div>
            ))}
          </dl>
          <p className="text-xs text-muted">Publish opens the event: invited players can accept and it appears in your feed. Save draft keeps it to yourself for now.</p>
        </div>
      )}

      {(refusal || error) && <p role="alert" className="text-sm rounded-lg px-3 py-2 bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200" data-event-wizard-refusal="">{refusal ?? error}</p>}

      <div className="sticky bottom-0 -mx-4 sm:-mx-6 -mb-4 sm:-mb-6 px-4 sm:px-6 py-3 bg-surface border-t border-border-subtle safe-bottom flex flex-wrap items-center justify-between gap-2">
        {stepIndex > 0 ? <button type="button" onClick={back} className={SECONDARY}>← Back</button> : <span />}
        {step !== 'review' ? (
          <button type="button" onClick={next} className={PRIMARY} data-event-wizard-next="">Next</button>
        ) : (
          <div className="flex gap-2">
            <button type="button" onClick={() => submit(false)} disabled={submitting} className={SECONDARY} data-event-wizard-draft="">Save draft</button>
            <button type="button" onClick={() => submit(true)} disabled={submitting} className={PRIMARY} data-event-wizard-publish="">{submitting ? 'Saving…' : 'Publish'}</button>
          </div>
        )}
      </div>

      <ConfirmModal
        isOpen={confirmOpen}
        title={COPY.FORMS.DISCARD_TITLE}
        message={COPY.FORMS.DISCARD_CONFIRM}
        confirmText={COPY.FORMS.DISCARD_ACTION}
        cancelText={COPY.FORMS.KEEP_EDITING}
        confirmButtonClass="bg-red-600 hover:bg-red-700 text-white"
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
    </div>
  );
}
