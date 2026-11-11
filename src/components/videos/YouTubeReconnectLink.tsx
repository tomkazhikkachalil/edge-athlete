import type { ScopeKey } from '@/lib/videos/youtube-connection';

/**
 * "Reconnect" (self-healing, Nov 10 2026): the one door a screen shows when
 * an answer says the connection has to be made again (`reconnect: true`) —
 * a navigation to the start route for this owner, asking the scope the
 * screen itself needs. No state. `returnTo` (the flow round) is the screen
 * to land back on — the Full game flow passes itself and saves its form in
 * `onNavigate`; without it the callback lands on the owner's Videos surface.
 */
export default function YouTubeReconnectLink({ owner, scope, returnTo, onNavigate }: { owner: string; scope: ScopeKey; returnTo?: string; onNavigate?: () => void }) {
  const href = `/api/videos/youtube/start?owner=${encodeURIComponent(owner)}&scope=${scope}${returnTo ? `&return=${encodeURIComponent(returnTo)}` : ''}`;
  return (
    <a href={href} onClick={onNavigate} className="underline font-semibold" data-youtube-reconnect-link={scope}>
      Reconnect
    </a>
  );
}
