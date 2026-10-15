'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useMessages } from '@/lib/messages';
import { useToast } from '@/components/Toast';

/**
 * The Message door on another athlete's profile (Tom, Oct 14 2026 — fix 4):
 * one tap opens the conversation with them, existing or new, and lands in
 * the chat with the composer ready. The profile never knows whether a
 * conversation exists: `POST /api/messages { type: 'direct' }` IS the
 * get-or-create (it also enforces blocks, departed accounts, the target's
 * messaging permission, the supervised sender's rule and the first-contact
 * hold — its refusal text is the honest word, shown as the error). The
 * matched half of ProfileActions' pair, beside Become a Fan.
 *
 * `compose=1` on the thread URL asks the composer to take focus once the
 * thread has loaded (iOS raises the keyboard only inside a tap, so there the
 * caret lands and one tap opens it; Android and desktop open it at once).
 */
interface MessageButtonProps {
  profileId: string;
  className?: string;
}

export default function MessageButton({ profileId, className = '' }: MessageButtonProps) {
  const { user, activeProfile } = useAuth();
  const router = useRouter();
  const { fetchConversations } = useMessages();
  const { showError } = useToast();
  const [opening, setOpening] = useState(false);
  // A DM is first-person: disabled with the fan button's tooltip while
  // "posting as" a managed athlete.
  const actingAs = !!activeProfile;

  if (!user || user.id === profileId) return null;

  const open = async () => {
    if (opening) return;
    setOpening(true);
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'direct', participantId: profileId }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        showError("Can't message", d.error || 'Failed to open the conversation');
        return;
      }
      await fetchConversations();
      router.push(`/messages?c=${d.conversationId}&compose=1`);
    } catch {
      showError("Can't message", 'Failed to open the conversation');
    } finally {
      setOpening(false);
    }
  };

  return (
    <button
      type="button"
      onClick={open}
      disabled={opening || actingAs}
      title={actingAs ? 'Switch back to your own account to do this' : undefined}
      data-profile-message=""
      className={`w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium min-h-[40px] whitespace-nowrap rounded-full border border-border-strong bg-surface text-brand-fg hover:bg-surface-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
    >
      {opening ? <i className="fas fa-spinner fa-spin" aria-hidden="true"></i> : <i className="fas fa-comment" aria-hidden="true"></i>}
      Message
    </button>
  );
}
