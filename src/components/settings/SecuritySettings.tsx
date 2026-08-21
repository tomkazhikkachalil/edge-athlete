'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import { supabase } from '@/lib/supabase';

// Password change: verifies the CURRENT password first, then updates via
// POST /api/auth/change-password (Round I — server-side so the rotation
// revokes other sessions and a supervised athlete's change bells their
// guardians). A hijacked open session can't silently change the password
// without knowing it. After success we re-sign-in with the NEW password:
// the rotation killed every refresh token, including this session's.
export default function SecuritySettings() {
  const { user, profile } = useAuth();
  const { showSuccess, showError } = useToast();
  const supervised = profile?.supervision_state === 'supervised';

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || !user?.email) return;

    if (newPassword.length < 6) {
      showError('Weak password', 'New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      showError('Mismatch', 'New passwords do not match.');
      return;
    }
    if (newPassword === currentPassword) {
      showError('No change', 'New password must be different from your current one.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showError('Update failed', data.error || 'Could not update your password.');
        return;
      }

      // The rotation revoked every session, including this one — mint a
      // fresh session with the new password so the user stays signed in.
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: newPassword,
      });
      if (signInError) {
        showError('Signed out', 'Your password changed — please log in again with the new one.');
        return;
      }

      showSuccess('Password updated', 'Your other devices were signed out.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      console.error('Password change failed:', err);
      showError('Update failed', 'Could not update your password. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    'w-full px-3 py-2 min-h-[44px] border border-border-strong rounded-md text-sm text-primary focus:outline-none focus:ring-2 focus:ring-violet-500';

  return (
    <div>
      <h2 className="text-lg font-semibold text-primary mb-1">Change password</h2>
      <p className="text-sm text-muted mb-6">
        Forgot your current password? Log out and use{' '}
        <span className="font-medium">Forgot password</span> on the login screen instead.
      </p>

      {supervised && (
        <div className="max-w-md mb-6 flex items-start gap-2 rounded-lg border border-violet-200 dark:border-violet-800 bg-brand-soft p-3 text-xs text-violet-900 dark:text-violet-200">
          <i className="fas fa-user-shield mt-0.5" aria-hidden="true"></i>
          <span>
            Your guardian is notified when you change your password. If you sign
            in with a PIN, ask your guardian to change it for you.
          </span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="max-w-md space-y-4">
        <div>
          <label htmlFor="current-password" className="block text-sm font-medium text-secondary mb-1">
            Current password
          </label>
          <input
            id="current-password"
            type="password"
            value={currentPassword}
            onChange={e => setCurrentPassword(e.target.value)}
            className={inputClass}
            autoComplete="current-password"
            required
          />
        </div>
        <div>
          <label htmlFor="new-password" className="block text-sm font-medium text-secondary mb-1">
            New password
          </label>
          <input
            id="new-password"
            type="password"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            className={inputClass}
            autoComplete="new-password"
            minLength={6}
            required
          />
        </div>
        <div>
          <label htmlFor="confirm-new-password" className="block text-sm font-medium text-secondary mb-1">
            Confirm new password
          </label>
          <input
            id="confirm-new-password"
            type="password"
            value={confirmPassword}
            onChange={e => setConfirmPassword(e.target.value)}
            className={inputClass}
            autoComplete="new-password"
            minLength={6}
            required
          />
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="bg-brand text-white py-2.5 px-6 rounded-md hover:bg-brand-hover transition font-medium min-h-[44px] disabled:opacity-50"
        >
          {submitting ? (
            <><i className="fas fa-spinner fa-spin mr-2"></i>Updating…</>
          ) : (
            'Update password'
          )}
        </button>
      </form>
    </div>
  );
}
