'use client';

import Link from 'next/link';
import { useMessages } from '@/lib/messages';

export default function MessagesBell() {
  const { totalUnreadCount } = useMessages();

  return (
    <Link
      href="/messages"
      className="relative p-2 text-gray-600 hover:text-gray-900 transition-colors"
      aria-label="Messages"
    >
      <i className="fas fa-comment-alt text-xl"></i>
      {totalUnreadCount > 0 && (
        <span className="absolute top-0 right-0 inline-flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-red-600 rounded-full">
          {totalUnreadCount > 99 ? '99+' : totalUnreadCount}
        </span>
      )}
    </Link>
  );
}
