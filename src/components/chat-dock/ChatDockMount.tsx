'use client';

/**
 * The chat dock's mount (speed round 2, Oct 4 2026). The dock is a DESKTOP
 * surface (ChatDock gates itself on `isDesktop`), yet it was imported
 * statically from the root layout — every phone downloaded the dock, its
 * panel, the mini thread and presence for nothing. This wrapper decides
 * with the same hook and loads the dock only where it will render.
 */

import dynamic from 'next/dynamic';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useAuth } from '@/lib/auth';

const ChatDock = dynamic(() => import('./ChatDock'), { ssr: false });

export default function ChatDockMount() {
  const isDesktop = useIsDesktop();
  const { user } = useAuth();
  if (!isDesktop || !user) return null;
  return <ChatDock />;
}
