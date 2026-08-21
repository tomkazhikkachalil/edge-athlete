'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import type { MessagingPermission } from '@/types/messages';
import GuardiansCard from './GuardiansCard';
import SupervisedSettingCard from './SupervisedSettingCard';
import BlockedUsersList from './BlockedUsersList';

interface PermissionOption {
  value: MessagingPermission;
  label: string;
  description: string;
  icon: string;
  iconColor: string;
}

const options: PermissionOption[] = [
  {
    value: 'everyone',
    label: 'Everyone',
    description: 'Any Edge Athlete user can send you a direct message.',
    icon: 'fa-globe',
    iconColor: 'text-brand-fg',
  },
  {
    value: 'fans_only',
    label: 'Fans Only',
    description: 'Only athletes who follow you can send you messages.',
    icon: 'fa-user-check',
    iconColor: 'text-green-600 dark:text-green-400',
  },
  {
    value: 'mutual_fans',
    label: 'Mutual Fans',
    description: 'Only athletes you both follow each other can message you.',
    icon: 'fa-users',
    iconColor: 'text-purple-600 dark:text-purple-400',
  },
  {
    value: 'nobody',
    label: 'Nobody',
    description: 'Turn off direct messages entirely. No one can message you.',
    icon: 'fa-ban',
    iconColor: 'text-red-600 dark:text-red-400',
  },
];

export default function MessagingSettings() {
  const { profile, refreshProfile } = useAuth();
  const { showSuccess, showError } = useToast();
  const [permission, setPermission] = useState<MessagingPermission>('everyone');
  const [saving, setSaving] = useState(false);

  // State synchronisation, not a side effect: doing it during render means
  // the previous values never paint for a frame.
  const [syncedProfile, setSyncedProfile] = useState({ profile });
  if (
    syncedProfile.profile !== profile
  ) {
    setSyncedProfile({ profile });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (profile as any)?.messaging_permission as MessagingPermission | undefined;
    if (p) setPermission(p);
  }

  const handleChange = async (newPermission: MessagingPermission) => {
    if (newPermission === permission || saving) return;
    setSaving(true);
    try {
      const res = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profileData: { messaging_permission: newPermission },
          userId: profile?.id,
        }),
      });
      if (!res.ok) throw new Error('Failed to update');
      setPermission(newPermission);
      await refreshProfile();
      showSuccess('Success', 'Messaging settings updated');
    } catch (e) {
      console.error('Failed to update messaging settings:', e);
      showError('Error', 'Failed to update messaging settings');
    } finally {
      setSaving(false);
    }
  };

  const supervised = profile?.supervision_state === 'supervised';
  const current = options.find((o) => o.value === permission) ?? options[0];

  return (
    <div className="space-y-6">
      {/* Supervised profiles see who manages them (renders nothing otherwise) */}
      <GuardiansCard />
      <div>
        <h3 className="text-lg font-semibold text-primary mb-2">Who Can Message You</h3>
        <p className="text-tertiary text-sm mb-6">
          {supervised
            ? 'This setting controls who can exchange messages with you.'
            : 'Control who is allowed to send you direct messages on Edge Athlete.'}
        </p>

        {supervised ? (
          <SupervisedSettingCard
            icon={current.icon}
            iconColor={current.iconColor}
            label={current.label}
            description={current.description}
          />
        ) : (
        <div className="space-y-3">
          {options.map((opt) => (
            <button
              key={opt.value}
              onClick={() => handleChange(opt.value)}
              disabled={saving}
              className={`w-full text-left p-4 rounded-lg border-2 transition-all disabled:opacity-60 ${
                permission === opt.value
                  ? 'border-brand bg-brand-soft'
                  : 'border-border hover:border-border-strong'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                  permission === opt.value
                    ? 'border-brand bg-brand'
                    : 'border-border-strong'
                }`}>
                  {permission === opt.value && (
                    <i className="fas fa-check text-white text-xs"></i>
                  )}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <i className={`fas ${opt.icon} ${opt.iconColor}`}></i>
                    <h4 className="font-semibold text-primary">{opt.label}</h4>
                  </div>
                  <p className="text-sm text-tertiary">{opt.description}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
        )}
      </div>

      <div className="bg-brand-soft border border-violet-200 dark:border-violet-800 rounded-lg p-4">
        <div className="flex gap-3">
          <i className="fas fa-info-circle text-brand-fg mt-0.5 shrink-0"></i>
          <div>
            <h4 className="font-medium text-violet-900 dark:text-violet-200 mb-1">Note</h4>
            <p className="text-sm text-violet-800 dark:text-violet-200">
              Group chats can still be created by admins regardless of this setting. Existing
              conversations are not affected when you change this setting.
            </p>
          </div>
        </div>
      </div>

      {/* Round I: the first place blocks are visible/reversible anywhere. */}
      <div>
        <h3 className="text-lg font-semibold text-primary mb-2">Blocked users</h3>
        <p className="text-tertiary text-sm mb-4">
          People you&apos;ve blocked can&apos;t message you. Blocking someone also closes
          any conversation you had with them.
        </p>
        <BlockedUsersList />
      </div>
    </div>
  );
}
