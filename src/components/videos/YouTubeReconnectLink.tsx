import type { ScopeKey } from '@/lib/videos/youtube-connection';

/**
 * "Reconnect" (self-healing, Nov 10 2026): the one door a screen shows when
 * an answer says the connection has to be made again (`reconnect: true`) —
 * a navigation to the start route for this owner, asking the scope the
 * screen itself needs. No state; the callback lands back on the owner's
 * Videos surface with the result.
 */
export default function YouTubeReconnectLink({ owner, scope }: { owner: string; scope: ScopeKey }) {
  return (
    <a href={`/api/videos/youtube/start?owner=${encodeURIComponent(owner)}&scope=${scope}`} className="underline font-semibold" data-youtube-reconnect-link={scope}>
      Reconnect
    </a>
  );
}
