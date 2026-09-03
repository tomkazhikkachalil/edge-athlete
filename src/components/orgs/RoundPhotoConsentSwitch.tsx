'use client';

import { useEffect, useState } from 'react';

// "Share my round photos with this club" (M2, program 10): a MEMBER's own
// switch on the in-app club page. Off by default; on = the club's
// manager may pick photos from this member's PUBLIC round posts for the
// club site (the member's private posts never qualify). A supervised
// member sees why the switch is unavailable instead of a switch.

export default function RoundPhotoConsentSwitch({ clubId }: { clubId: string }) {
  const [state, setState] = useState<{ consent: boolean; eligible: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/clubs/${encodeURIComponent(clubId)}/photo-consent`);
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as { consent: boolean; eligible: boolean };
        if (!cancelled) setState(body);
      } catch {
        /* the switch simply stays hidden */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clubId]);

  if (!state) return null;

  const flip = async (consent: boolean) => {
    const prior = state.consent;
    setState(s => (s ? { ...s, consent } : s)); // optimistic — reverted on failure
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/clubs/${encodeURIComponent(clubId)}/photo-consent`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consent }),
      });
      const body = (await res.json().catch(() => ({}))) as { consent?: boolean; error?: string };
      if (!res.ok) {
        setState(s => (s ? { ...s, consent: prior } : s));
        setError(body.error || 'Could not update photo sharing');
        return;
      }
      setState(s => (s ? { ...s, consent: !!body.consent } : s));
    } catch {
      setState(s => (s ? { ...s, consent: prior } : s));
      setError('Could not update photo sharing');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-label="Round photos"
      className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6"
      data-round-photo-consent={state.consent ? 'on' : 'off'}
    >
      <h2 className="text-lg font-semibold text-primary">Round photos</h2>
      {state.eligible ? (
        <>
          <label className="mt-2 flex items-start gap-3 text-sm text-secondary">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={state.consent}
              disabled={busy}
              onChange={e => flip(e.target.checked)}
              aria-label="Share my round photos with this club"
            />
            <span>
              <span className="font-medium text-primary">Share my round photos with this club.</span>{' '}
              The club may put photos from your <strong>public</strong> round posts on its website. Private posts never qualify,
              and you can switch this off any time.
            </span>
          </label>
          {error && <p className="mt-2 text-sm text-error">{error}</p>}
        </>
      ) : (
        <p className="mt-2 text-sm text-secondary">Round photos of a supervised athlete never go on a club website.</p>
      )}
    </section>
  );
}
