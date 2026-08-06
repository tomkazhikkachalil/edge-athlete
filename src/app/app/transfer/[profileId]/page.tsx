'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import BrandBar from '@/components/BrandBar';
import ConfirmModal from '@/components/ConfirmModal';
import { FEATURE_FLAGS } from '@/lib/features';
import { formatDisplayName } from '@/lib/formatters';
import { formatCountdown, type ClientTransfer, type ViewerRole } from '@/lib/transfer-ui';

// ── Transfer of control ──────────────────────────────────────────────────────
// ONE page for BOTH parties: the guardian and the supervised athlete each see
// their side of the handover, keyed by (viewerRole, state). The server is the
// only authority — every action re-fetches instead of patching local state.
// Acting-as (activeProfile) is deliberately ignored: the signed-in auth user
// determines viewerRole server-side.

export default function TransferPage() {
  const params = useParams();
  const router = useRouter();
  const { user, loading, initialAuthCheckComplete, managedProfiles } = useAuth();
  const profileId = params.profileId as string;

  const [view, setView] = useState<'loading' | 'forbidden' | 'ready'>('loading');
  const [transfer, setTransfer] = useState<ClientTransfer | null>(null);
  const [viewerRole, setViewerRole] = useState<ViewerRole | null>(null);
  const [error, setError] = useState('');
  const [acting, setActing] = useState(false);
  const [justCancelled, setJustCancelled] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  // Athlete credentials step:
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [editingEmail, setEditingEmail] = useState(false);
  const [codeResent, setCodeResent] = useState(false);
  // Athlete dual-confirm choice:
  const [postRole, setPostRole] = useState<'viewer' | 'removed'>('viewer');
  // Cooling-off countdown ticker:
  const [nowTick, setNowTick] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/transfers?profileId=${profileId}`);
      if (res.status === 403) { setView('forbidden'); return; }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || 'Could not load the transfer.'); setView('ready'); return; }
      setTransfer(data.transfer ?? null);
      setViewerRole(data.viewerRole ?? null);
      setView('ready');
    } catch {
      setError('Could not load the transfer.');
      setView('ready');
    }
  }, [profileId]);

  useEffect(() => {
    if (!loading && initialAuthCheckComplete && !user) router.replace('/');
  }, [user, loading, initialAuthCheckComplete, router]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  // Both parties act at different times — poll while a transfer is in flight
  // and refresh on tab re-focus so "waiting" screens advance on their own.
  useEffect(() => {
    if (!transfer) return;
    const interval = setInterval(load, 30_000);
    const onVisible = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [transfer, load]);

  useEffect(() => {
    if (transfer?.state !== 'cooling_off') return;
    const interval = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, [transfer?.state]);

  const post = async (url: string, body: object): Promise<boolean> => {
    setActing(true);
    setError('');
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Something went wrong. Please try again.');
        // Terminal (410) or aborted (409) transfers: re-fetch so the stale
        // form collapses to the current truth instead of stranding the user.
        if (res.status === 410 || res.status === 409) await load();
        return false;
      }
      await load();
      return true;
    } catch {
      setError('Something went wrong. Please try again.');
      return false;
    } finally {
      setActing(false);
    }
  };

  const start = () => post('/api/transfers', { profileId });
  const act = (body: object) => post(`/api/transfers/${transfer!.id}`, body);

  const submitContact = async (e: React.FormEvent) => {
    e.preventDefault();
    setCodeResent(false);
    if (await act({ action: 'submit_contact', email: email.trim() })) {
      setEditingEmail(false);
      setCode('');
    }
  };

  const resendCode = async () => {
    if (!transfer?.athlete_contact_email) return;
    setCodeResent(false);
    if (await act({ action: 'submit_contact', email: transfer.athlete_contact_email })) {
      setCodeResent(true);
      setCode('');
    }
  };

  const verifyContact = async (e: React.FormEvent) => {
    e.preventDefault();
    await act({ action: 'verify_contact', code: code.trim() });
  };

  const cancel = async () => {
    setConfirmingCancel(false);
    if (await act({ action: 'cancel' })) setJustCancelled(true);
  };

  if (!FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES || loading || !initialAuthCheckComplete || !user || view === 'loading') {
    return (
      <div className="min-h-screen bg-brand-soft flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand"></div>
      </div>
    );
  }

  const isGuardian = viewerRole === 'guardian';
  const isAthlete = viewerRole === 'supervised';
  const state = transfer?.state ?? 'none';
  const managedEntry = managedProfiles.find(p => p.id === profileId);
  const athleteName = isGuardian
    ? formatDisplayName(managedEntry?.first_name, null, managedEntry?.last_name, managedEntry?.full_name) || 'your athlete'
    : '';
  const bothConfirmView = {
    athlete: !!transfer?.athlete_confirmed_at,
    guardian: !!transfer?.guardian_confirmed_at,
  };

  const cancelButton = (label: string) => (
    <button
      type="button"
      onClick={() => setConfirmingCancel(true)}
      disabled={acting}
      className="border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 px-4 py-2 rounded-md text-sm font-medium hover:bg-red-50 dark:hover:bg-red-950/40 transition disabled:opacity-50"
    >
      {label}
    </button>
  );

  const primaryButton = (label: string, onClick: () => void, busyLabel = 'Working...') => (
    <button
      type="button"
      onClick={onClick}
      disabled={acting}
      className="w-full bg-brand text-white py-3 px-4 rounded-md hover:bg-brand-hover transition flex items-center justify-center text-sm font-medium disabled:opacity-50"
    >
      {acting ? <><i className="fas fa-spinner fa-spin mr-2"></i> {busyLabel}</> : label}
    </button>
  );

  const confirmRows = (
    <div className="bg-surface-muted border border-border rounded-md p-4 mb-4 text-sm">
      {[
        { who: isAthlete ? 'You' : athleteName, done: bothConfirmView.athlete },
        { who: isGuardian ? 'You' : 'Your guardian', done: bothConfirmView.guardian },
      ].map(row => (
        <div key={row.who} className="flex items-center gap-2 py-1">
          <i className={`fas ${row.done ? 'fa-circle-check text-brand-fg' : 'fa-clock text-faint'}`}></i>
          <span className="text-primary">{row.who}</span>
          <span className="text-muted">{row.done ? 'confirmed' : 'waiting'}</span>
        </div>
      ))}
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col bg-brand-soft">
      <BrandBar hideEscape={state === 'executing'} />
      <div className="flex-grow flex items-center justify-center p-4">
        <div className="w-full max-w-2xl bg-surface rounded-lg shadow-lg p-6 sm:p-8">
          {error && (
            <div role="alert" className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded-md text-sm mb-4">
              {error}
            </div>
          )}

          {(view === 'forbidden' || (!isGuardian && !isAthlete)) ? (
            <p className="text-sm text-tertiary text-center py-8">
              There&apos;s nothing for you to do here.
            </p>
          ) : justCancelled ? (
            <div className="text-center py-6">
              <i className="fas fa-circle-check text-brand-fg text-4xl mb-4"></i>
              <h2 className="text-xl sm:text-2xl font-bold text-violet-800 dark:text-violet-200 mb-2">
                {isAthlete ? 'Okay — the handover is off' : 'Transfer cancelled'}
              </h2>
              <p className="text-sm text-tertiary max-w-md mx-auto mb-6">
                {isAthlete
                  ? 'Nothing changes, and you can ask again whenever you&#39;re ready.'
                  : 'Nothing has changed — you can start again any time.'}
              </p>
              <button type="button" onClick={() => router.push('/athlete')} className="text-sm text-brand-fg hover:underline">
                Back to my account
              </button>
            </div>
          ) : state === 'none' ? (
            managedEntry?.supervision_state === 'self' ? (
              <div className="text-center py-6">
                <i className="fas fa-circle-check text-brand-fg text-4xl mb-4"></i>
                <h2 className="text-xl sm:text-2xl font-bold text-violet-800 dark:text-violet-200 mb-2">Already handed over</h2>
                <p className="text-sm text-tertiary max-w-md mx-auto">
                  {athleteName} owns this account now.
                </p>
              </div>
            ) : (
              <>
                <h2 className="text-xl sm:text-2xl font-bold text-violet-800 dark:text-violet-200 mb-2">
                  {isGuardian ? 'Hand over this account' : 'Take over your account'}
                </h2>
                <p className="text-sm text-tertiary mb-6">
                  {isGuardian
                    ? `Starting the handover lets ${athleteName} add an email of their own and become the owner of this account. Nothing changes until you both confirm, and there's a 7-day waiting period you can cancel at any point.`
                    : 'Ready to run your own account? Ask to take over — your guardian will need to say yes first, and nothing changes until you both confirm.'}
                </p>
                {primaryButton(isGuardian ? 'Start the handover' : 'Ask to take over my account', start)}
              </>
            )
          ) : state === 'eligible_notified' ? (
            <>
              <h2 className="text-xl sm:text-2xl font-bold text-violet-800 dark:text-violet-200 mb-2">
                {isGuardian
                  ? `${athleteName} is old enough to run their own account`
                  : "You're old enough to run your own account!"}
              </h2>
              <p className="text-sm text-tertiary mb-6">
                {isGuardian
                  ? `Starting the handover lets ${athleteName} add their own email and take over after a 7-day waiting period. You both confirm before anything happens, and either of you can cancel until the very end.`
                  : 'Ask to take over — your guardian will need to say yes first, and nothing changes until you both confirm.'}
              </p>
              {primaryButton(isGuardian ? 'Start the handover' : 'Ask to take over', start)}
            </>
          ) : state === 'requested' ? (
            isGuardian ? (
              <>
                <h2 className="text-xl sm:text-2xl font-bold text-violet-800 dark:text-violet-200 mb-2">
                  {athleteName} asked to take over their account
                </h2>
                <p className="text-sm text-tertiary mb-6">
                  Approving starts the handover: they&apos;ll add an email of their own, you&apos;ll both
                  confirm, and there&apos;s a 7-day waiting period either of you can cancel.
                </p>
                <div className="flex flex-col gap-3">
                  {primaryButton('Approve the handover', () => act({ action: 'confirm' }))}
                  <div className="text-center">{cancelButton('Decline')}</div>
                </div>
              </>
            ) : (
              <div className="text-center py-6">
                <i className="fas fa-hourglass-half text-brand-fg text-4xl mb-4"></i>
                <h2 className="text-xl sm:text-2xl font-bold text-violet-800 dark:text-violet-200 mb-2">We&apos;ve told your guardian</h2>
                <p className="text-sm text-tertiary max-w-md mx-auto mb-6">
                  They need to say yes before anything happens. Check back soon!
                </p>
                {cancelButton('Never mind')}
              </div>
            )
          ) : (state === 'initiated' || state === 'credentials_pending') && isGuardian ? (
            <div className="text-center py-6">
              <i className="fas fa-hourglass-half text-brand-fg text-4xl mb-4"></i>
              <h2 className="text-xl sm:text-2xl font-bold text-violet-800 dark:text-violet-200 mb-2">Waiting on {athleteName}</h2>
              <p className="text-sm text-tertiary max-w-md mx-auto mb-6">
                They&apos;re adding an email address that belongs just to them. Nothing changes
                until you both confirm.
              </p>
              {cancelButton('Cancel the handover')}
            </div>
          ) : (state === 'initiated' || (state === 'credentials_pending' && editingEmail)) && isAthlete ? (
            <>
              <h2 className="text-xl sm:text-2xl font-bold text-violet-800 dark:text-violet-200 mb-2">Add an email that&apos;s yours alone</h2>
              <p className="text-sm text-tertiary mb-6">
                Not your guardian&apos;s — one only you can check. We&apos;ll send it a 6-digit code
                to make sure it&apos;s really yours.
              </p>
              <form onSubmit={submitContact} className="flex flex-col gap-4">
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  className="w-full border border-border-strong rounded-md px-4 py-3 text-sm text-primary focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
                <button
                  type="submit"
                  disabled={acting || !email.trim()}
                  className="w-full bg-brand text-white py-3 px-4 rounded-md hover:bg-brand-hover transition flex items-center justify-center text-sm font-medium disabled:opacity-50"
                >
                  {acting ? <><i className="fas fa-spinner fa-spin mr-2"></i> Sending...</> : (editingEmail ? 'Use this email instead' : 'Send my code')}
                </button>
              </form>
              <div className="text-center mt-4">
                {editingEmail
                  ? (
                    <button type="button" onClick={() => setEditingEmail(false)} className="text-sm text-brand-fg hover:underline">
                      Back to the code
                    </button>
                  )
                  : cancelButton('Never mind')}
              </div>
            </>
          ) : state === 'credentials_pending' && isAthlete ? (
            <>
              <h2 className="text-xl sm:text-2xl font-bold text-violet-800 dark:text-violet-200 mb-2">Check your email</h2>
              <p className="text-sm text-tertiary mb-6">
                We emailed a 6-digit code to <span className="font-semibold text-primary">{transfer?.athlete_contact_email}</span>.
                It works for 15 minutes.
              </p>
              {codeResent && (
                <div className="bg-brand-soft border border-violet-200 dark:border-violet-800 text-brand-fg-strong px-4 py-3 rounded-md text-sm mb-4">
                  A new code is on its way.
                </div>
              )}
              <form onSubmit={verifyContact} className="flex flex-col gap-4">
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  pattern="[0-9]{6}"
                  value={code}
                  onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="••••••"
                  aria-label="6-digit code"
                  className="w-full border border-border-strong rounded-md px-4 py-3 text-center text-2xl tracking-[0.5em] font-mono text-primary focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
                <button
                  type="submit"
                  disabled={acting || code.length !== 6}
                  className="w-full bg-brand text-white py-3 px-4 rounded-md hover:bg-brand-hover transition flex items-center justify-center text-sm font-medium disabled:opacity-50"
                >
                  {acting ? <><i className="fas fa-spinner fa-spin mr-2"></i> Checking...</> : 'Verify'}
                </button>
              </form>
              <div className="flex flex-col items-center gap-2 mt-4">
                <button type="button" onClick={resendCode} disabled={acting} className="text-sm text-brand-fg hover:underline disabled:opacity-50">
                  Send a new code
                </button>
                <button
                  type="button"
                  onClick={() => { setEditingEmail(true); setEmail(transfer?.athlete_contact_email ?? ''); }}
                  className="text-sm text-brand-fg hover:underline"
                >
                  Use a different email
                </button>
                {cancelButton('Never mind')}
              </div>
            </>
          ) : state === 'dual_confirm' ? (
            <>
              <h2 className="text-xl sm:text-2xl font-bold text-violet-800 dark:text-violet-200 mb-2">Confirm the handover</h2>
              <p className="text-sm text-tertiary mb-4">
                {isGuardian
                  ? `Once you both confirm, a 7-day waiting period starts — then ${athleteName} becomes the owner of this account. Either of you can cancel during the wait.`
                  : 'Once you both confirm, a 7-day wait starts — then the account is yours. You can still change your mind during the wait.'}
              </p>
              {confirmRows}
              {isAthlete && !bothConfirmView.athlete && (
                <fieldset className="mb-4">
                  <legend className="text-sm font-medium text-secondary mb-2">After the handover, your guardian…</legend>
                  {([
                    { value: 'viewer', label: 'can still see my profile', hint: 'They keep a view-only window — no control.' },
                    { value: 'removed', label: 'no longer sees my account', hint: 'Their access is removed completely.' },
                  ] as const).map(opt => (
                    <label key={opt.value} className="flex items-start gap-3 py-2 cursor-pointer">
                      <input
                        type="radio"
                        name="postRole"
                        checked={postRole === opt.value}
                        onChange={() => setPostRole(opt.value)}
                        className="mt-1 accent-violet-600"
                      />
                      <span className="text-sm">
                        <span className="text-primary font-medium">{opt.label}</span>
                        <span className="block text-muted">{opt.hint}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
              )}
              {(isAthlete && !bothConfirmView.athlete) && primaryButton("Confirm — I'm ready", () => act({ action: 'confirm', guardianPostRole: postRole }))}
              {(isGuardian && !bothConfirmView.guardian) && primaryButton('Confirm the handover', () => act({ action: 'confirm' }))}
              {((isAthlete && bothConfirmView.athlete) || (isGuardian && bothConfirmView.guardian)) && (
                <p className="text-sm text-tertiary mb-2">
                  {isAthlete ? "You've confirmed! Waiting for your guardian." : `You've confirmed — waiting for ${athleteName}.`}
                </p>
              )}
              <div className="text-center mt-4">{cancelButton(isAthlete ? 'Never mind' : 'Cancel the handover')}</div>
            </>
          ) : state === 'cooling_off' ? (
            <>
              <h2 className="text-xl sm:text-2xl font-bold text-violet-800 dark:text-violet-200 mb-2">
                {isAthlete ? 'Almost there!' : 'Handover in progress'}
              </h2>
              <p className="text-sm text-secondary mb-4">
                {isAthlete
                  ? <>In <span className="font-semibold">{formatCountdown(transfer!.cooling_off_ends_at!, new Date(nowTick))}</span> this account becomes yours.</>
                  : <>The handover completes in <span className="font-semibold">{formatCountdown(transfer!.cooling_off_ends_at!, new Date(nowTick))}</span>.</>}
              </p>
              <ul className="text-sm text-tertiary mb-6 space-y-2 list-disc pl-5">
                <li>The account email switches to <span className="font-medium text-primary">{transfer?.athlete_contact_email}</span>.</li>
                <li>{isAthlete ? "We'll email you a link to set a brand-new password." : `${athleteName} gets a link to set their own password.`}</li>
                <li>
                  {transfer?.guardian_post_role === 'removed'
                    ? (isAthlete ? 'Your guardian will no longer see your account.' : 'Your access will be removed.')
                    : (isAthlete ? 'Your guardian can still see your profile (view-only).' : 'Your access becomes view-only.')}
                </li>
              </ul>
              <p className="text-sm text-tertiary mb-4">
                {isAthlete ? 'Changed your mind? You can still stop it.' : 'Either of you can still cancel until the wait ends.'}
              </p>
              <div className="text-center">{cancelButton('Cancel the handover')}</div>
            </>
          ) : state === 'executing' ? (
            <div className="text-center py-6">
              <i className="fas fa-arrows-rotate text-brand-fg text-4xl mb-4"></i>
              <h2 className="text-xl sm:text-2xl font-bold text-violet-800 dark:text-violet-200 mb-2">
                {isAthlete ? "It's happening!" : 'The handover is completing now'}
              </h2>
              <p className="text-sm text-tertiary max-w-md mx-auto">
                {isAthlete
                  ? <>Your account is being handed to you. Watch <span className="font-medium text-primary">{transfer?.athlete_contact_email}</span> for a link to set your new password. (You&apos;ll be signed out when it&apos;s done.)</>
                  : 'This can no longer be cancelled. It finishes within a day.'}
              </p>
            </div>
          ) : null}
        </div>
      </div>

      <ConfirmModal
        isOpen={confirmingCancel}
        title={isAthlete ? 'Stop the handover?' : 'Cancel the handover?'}
        message={isAthlete
          ? 'Nothing changes — your guardian keeps managing your account, and you can ask again any time.'
          : 'Nothing changes — the account stays supervised, and you can start again any time.'}
        confirmText={isAthlete ? 'Yes, stop it' : 'Yes, cancel it'}
        cancelText="Keep going"
        onConfirm={cancel}
        onCancel={() => setConfirmingCancel(false)}
      />
    </div>
  );
}
