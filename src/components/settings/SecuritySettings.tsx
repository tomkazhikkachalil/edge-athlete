'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import { supabase } from '@/lib/supabase';

// Password change: verifies the CURRENT password first (signInWithPassword
// re-auth — same pattern DeleteAccountModal uses), then updates. A hijacked
// open session can't silently change the password without knowing it.
export default function SecuritySettings() {
  const { user } = useAuth();
  const { showSuccess, showError } = useToast();

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
      // Re-authenticate with the current password before allowing the change
      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      });
      if (reauthError) {
        showError('Incorrect password', 'Your current password is not correct.');
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) {
        showError('Update failed', updateError.message || 'Could not update your password.');
        return;
      }

      showSuccess('Password updated', 'Use your new password next time you log in.');
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
