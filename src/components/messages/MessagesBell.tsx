'use client';

import Link from 'next/link';
import { useMessages } from '@/lib/messages';
import FaIcon from '@/components/FaIcon';
import { faMessage } from '@/lib/icons/fa/message';

export default function MessagesBell() {
  const { totalUnreadCount } = useMessages();
  const hasUnread = totalUnreadCount > 0;

  return (
    <Link
      href="/messages"
      className="ea-icon-btn inline-flex items-center justify-center shrink-0"
      aria-label={hasUnread ? `Messages, ${totalUnreadCount} unread` : 'Messages'}
    >
      <FaIcon icon={faMessage} className="text-xl" />
      {hasUnread && (
        // A DOT, not a number. The exact count is not actionable from here —
        // you open messages either way — and the old 20px circle could not fit
        // "99+" without overflowing. The ring separates it from the header,
        // which now has a translucent blurred background.
        <span
          className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-red-600 ring-2 ring-white"
          aria-hidden="true"
        />
      )}
    </Link>
  );
}
