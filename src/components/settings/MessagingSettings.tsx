'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import type { MessagingPermission } from '@/types/messages';

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
    iconColor: 'text-blue-600',
  },
  {
    value: 'fans_only',
    label: 'Fans Only',
    description: 'Only athletes who follow you can send you messages.',
    icon: 'fa-user-check',
    iconColor: 'text-green-600',
  },
  {
    value: 'mutual_fans',
    label: 'Mutual Fans',
    description: 'Only athletes you both follow each other can message you.',
    icon: 'fa-users',
    iconColor: 'text-purple-600',
  },
  {
    value: 'nobody',
    label: 'Nobody',
    description: 'Turn off direct messages entirely. No one can message you.',
    icon: 'fa-ban',
    iconColor: 'text-red-600',
  },
];

export default function MessagingSettings() {
  const { profile, refreshProfile } = useAuth();
  const { showSuccess, showError } = useToast();
  const [permission, setPermission] = useState<MessagingPermission>('everyone');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = (profile as any)?.messaging_permission as MessagingPermission | undefined;
    if (p) setPermission(p);
  }, [profile]);

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
    } catch {
      showError('Error', 'Failed to update messaging settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Who Can Message You</h3>
        <p className="text-gray-600 text-sm mb-6">
          Control who is allowed to send you direct messages on Edge Athlete.
        </p>

        <div className="space-y-3">
          {options.map((opt) => (
            <button
              key={opt.value}
              onClick={() => handleChange(opt.value)}
              disabled={saving}
              className={`w-full text-left p-4 rounded-lg border-2 transition-all disabled:opacity-60 ${
                permission === opt.value
                  ? 'border-blue-600 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                  permission === opt.value
                    ? 'border-blue-600 bg-blue-600'
                    : 'border-gray-300'
                }`}>
                  {permission === opt.value && (
                    <i className="fas fa-check text-white text-xs"></i>
                  )}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <i className={`fas ${opt.icon} ${opt.iconColor}`}></i>
                    <h4 className="font-semibold text-gray-900">{opt.label}</h4>
                  </div>
                  <p className="text-sm text-gray-600">{opt.description}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex gap-3">
          <i className="fas fa-info-circle text-blue-600 mt-0.5 shrink-0"></i>
          <div>
            <h4 className="font-medium text-blue-900 mb-1">Note</h4>
            <p className="text-sm text-blue-800">
              Group chats can still be created by admins regardless of this setting. Existing
              conversations are not affected when you change this setting.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
