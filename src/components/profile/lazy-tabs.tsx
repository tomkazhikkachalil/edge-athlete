'use client';

/**
 * The profile's tabs and their modals as their own chunks (Sprint 4 PR 1,
 * Nov 2026). A visitor opens ONE tab; before this every tab — the Stats hub,
 * Training (with the composer), Videos, Tagged, Equipment, Achievements — and
 * two modals shipped in the profile route's first load, which sat at 598 KB of
 * the 600 KB route budget (scripts/bundle-weight-rules.mjs).
 *
 * One file so /athlete, /athlete/[id] and /u/[username] share the same chunks
 * (route parity). A tab shows the placeholder for the moment its chunk loads;
 * it holds height so the deep-link scroll pin in ProfileMediaTabs has
 * something to pin to. Modals have no placeholder: nothing is shown until the
 * chunk is there.
 */
import dynamic from 'next/dynamic';

function TabLoading() {
  return <div className="min-h-[40vh] w-full" aria-busy="true" data-tab-loading="" />;
}

// next/dynamic takes its options as an object LITERAL at each call (the build refuses a shared constant).
export const LazyStatsHub = dynamic(() => import('@/components/stats/StatsHub'), { ssr: false, loading: TabLoading });
export const LazyTrainingTab = dynamic(() => import('@/components/TrainingTab'), { ssr: false, loading: TabLoading });
export const LazyProfileVideosTab = dynamic(() => import('@/components/profile/ProfileVideosTab'), { ssr: false, loading: TabLoading });
export const LazyTaggedTab = dynamic(() => import('@/components/TaggedTab'), { ssr: false, loading: TabLoading });
export const LazyEquipmentSection = dynamic(() => import('@/components/EquipmentSection'), { ssr: false, loading: TabLoading });
export const LazyAchievementsTab = dynamic(() => import('@/components/AchievementsTab'), { ssr: false, loading: TabLoading });

export const LazyPostDetailModal = dynamic(() => import('@/components/PostDetailModal'), { ssr: false });
export const LazyEditPostModal = dynamic(() => import('@/components/EditPostModal'), { ssr: false });
export const LazyFollowersModal = dynamic(() => import('@/components/FollowersModal'), { ssr: false });
