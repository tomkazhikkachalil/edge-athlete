'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/Toast';

interface DeleteAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function DeleteAccountModal({ isOpen, onClose }: DeleteAccountModalProps) {
  const { user, profile } = useAuth();
  const router = useRouter();
  const { showError } = useToast();

  const [step, setStep] = useState<1 | 2>(1);
  const [confirmText, setConfirmText] = useState('');
  const [password, setPassword] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [reauthPassword, setReauthPassword] = useState('');
  const [isReauthenticating, setIsReauthenticating] = useState(false);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setStep(1);
      setConfirmText('');
      setPassword('');
      setNeedsReauth(false);
      setReauthPassword('');
      checkSessionAge();
    }
  }, [isOpen]);

  // Check if session is older than 10 minutes
  const checkSessionAge = async () => {
    try {
      const response = await fetch('/api/auth/check-session');
      const data = await response.json();

      if (data.needsReauth) {
        setNeedsReauth(true);
      }
    } catch (error) {
      console.error('Error checking session:', error);
      // Assume re-auth is needed for safety
      setNeedsReauth(true);
    }
  };

  const handleReauthenticate = async () => {
    if (!user?.email || !reauthPassword) {
      showError('Error', 'Please enter your password');
      return;
    }

    setIsReauthenticating(true);

    try {
      const response = await fetch('/api/auth/reauthenticate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: user.email,
          password: reauthPassword
        })
      });

      if (!response.ok) {
        throw new Error('Invalid password');
      }

      setNeedsReauth(false);
      setReauthPassword('');
      showError('Success', 'Re-authenticated successfully');
    } catch (error) {
      showError('Error', 'Invalid password. Please try again.');
    } finally {
      setIsReauthenticating(false);
    }
  };

  const handleNext = () => {
    if (step === 1) {
      setStep(2);
    }
  };

  const handleBack = () => {
    if (step === 2) {
      setStep(1);
    }
  };

  const handleDelete = async () => {
    // Validate confirmation text
    const expectedText = profile?.full_name || profile?.email || '';
    if (confirmText.toLowerCase() !== expectedText.toLowerCase()) {
      showError('Error', `Please type "${expectedText}" to confirm`);
      return;
    }

    // Validate password
    if (!password) {
      showError('Error', 'Please enter your password to confirm deletion');
      return;
    }

    setIsDeleting(true);

    try {
      const response = await fetch('/api/account/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmText,
          password
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete account');
      }

      // Success - redirect to goodbye page
      window.location.href = '/goodbye';
    } catch (error) {
      console.error('Account deletion error:', error);
      showError(
        'Error',
        error instanceof Error ? error.message : 'Failed to delete account. Please try again.'
      );
    } finally {
      setIsDeleting(false);
    }
  };

  const handleClose = () => {
    if (!isDeleting) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black bg-opacity-75"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-2xl bg-white rounded-lg shadow-xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
              <i className="fas fa-exclamation-triangle text-red-600"></i>
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">Delete Account</h2>
              <p className="text-sm text-gray-500">Step {step} of 2</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            disabled={isDeleting}
            className="text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
          >
            <i className="fas fa-times text-xl"></i>
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Re-authentication Required */}
          {needsReauth && (
            <div className="mb-6 bg-yellow-50 border-2 border-yellow-200 rounded-lg p-4">
              <div className="flex items-start gap-3 mb-4">
                <i className="fas fa-shield-alt text-yellow-600 mt-1"></i>
                <div>
                  <h4 className="font-semibold text-yellow-900 mb-1">
                    Security Check Required
                  </h4>
                  <p className="text-sm text-yellow-800">
                    Please re-enter your password to continue with account deletion.
                  </p>
                </div>
              </div>
              <div className="space-y-3">
                <input
                  type="password"
                  value={reauthPassword}
                  onChange={(e) => setReauthPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full px-4 py-2 border border-yellow-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-500"
                  disabled={isReauthenticating}
                />
                <button
                  onClick={handleReauthenticate}
                  disabled={isReauthenticating || !reauthPassword}
                  className="w-full bg-yellow-600 text-white px-4 py-2 rounded-lg hover:bg-yellow-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                >
                  {isReauthenticating ? (
                    <>
                      <i className="fas fa-spinner fa-spin mr-2"></i>
                      Verifying...
                    </>
                  ) : (
                    <>
                      <i className="fas fa-check mr-2"></i>
                      Verify Password
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Step 1: Confirmation & Warning */}
          {step === 1 && (
            <div className="space-y-6">
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <h3 className="font-semibold text-red-900 mb-2">
                  ⚠️ This action cannot be undone
                </h3>
                <p className="text-red-800 text-sm">
                  Deleting your account will permanently remove all your data from Edge Athlete.
                  This includes your profile, posts, stats, connections, and all other content.
                </p>
              </div>

              <div>
                <h4 className="font-semibold text-gray-900 mb-3">
                  The following will be permanently deleted:
                </h4>
                <div className="space-y-2">
                  {[
                    { icon: 'fa-user', text: 'Your profile and personal information' },
                    { icon: 'fa-images', text: 'All posts, photos, and videos you\'ve shared' },
                    { icon: 'fa-comment', text: 'All your comments and likes' },
                    { icon: 'fa-user-friends', text: 'Your followers and following connections' },
                    { icon: 'fa-chart-line', text: 'All performance stats, rounds, and achievements' },
                    { icon: 'fa-bell', text: 'Your notifications and activity history' },
                    { icon: 'fa-bookmark', text: 'Your saved posts and bookmarks' },
                    { icon: 'fa-golf-ball', text: 'All sport-specific data (golf rounds, etc.)' },
                  ].map((item, index) => (
                    <div key={index} className="flex items-center gap-3 text-gray-700">
                      <i className={`fas ${item.icon} text-red-600 w-5 text-center`}></i>
                      <span className="text-sm">{item.text}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <h4 className="font-medium text-gray-900 mb-2">Before you go...</h4>
                <p className="text-sm text-gray-600 mb-3">
                  Is there something we could do better? Your feedback helps us improve Edge Athlete.
                </p>
                <a
                  href="mailto:support@edgeathlete.com"
                  className="text-blue-600 hover:text-blue-700 text-sm font-medium"
                >
                  Send us feedback →
                </a>
              </div>
            </div>
          )}

          {/* Step 2: Final Confirmation */}
          {step === 2 && (
            <div className="space-y-6">
              <div className="bg-red-50 border-2 border-red-300 rounded-lg p-4">
                <h3 className="font-bold text-red-900 mb-2 text-lg">
                  Final Confirmation Required
                </h3>
                <p className="text-red-800 text-sm">
                  This is your last chance to back out. Once you confirm, your account and all
                  associated data will be permanently deleted within 24 hours.
                </p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  Type your {profile?.full_name ? 'username' : 'email'} to confirm:
                  <span className="ml-2 text-red-600">
                    {profile?.full_name || profile?.email}
                  </span>
                </label>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder={profile?.full_name || profile?.email || ''}
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
                  disabled={isDeleting || needsReauth}
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">
                  Re-enter your password:
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-red-500"
                  disabled={isDeleting || needsReauth}
                />
                <p className="text-xs text-gray-500 mt-1">
                  For your security, we need to verify your identity before proceeding.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {step === 2 && (
              <button
                onClick={handleBack}
                disabled={isDeleting}
                className="px-4 py-2 text-gray-700 hover:text-gray-900 font-medium transition-colors disabled:opacity-50"
              >
                <i className="fas fa-arrow-left mr-2"></i>
                Back
              </button>
            )}
            <button
              onClick={handleClose}
              disabled={isDeleting}
              className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium disabled:opacity-50"
            >
              Cancel
            </button>
          </div>

          <div>
            {step === 1 ? (
              <button
                onClick={handleNext}
                disabled={needsReauth}
                className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Continue to Confirm
                <i className="fas fa-arrow-right ml-2"></i>
              </button>
            ) : (
              <button
                onClick={handleDelete}
                disabled={
                  isDeleting ||
                  needsReauth ||
                  confirmText.toLowerCase() !== (profile?.full_name || profile?.email || '').toLowerCase() ||
                  !password
                }
                className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-bold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isDeleting ? (
                  <>
                    <i className="fas fa-spinner fa-spin mr-2"></i>
                    Deleting Account...
                  </>
                ) : (
                  <>
                    <i className="fas fa-trash-alt mr-2"></i>
                    Delete My Account
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
