'use client';

import { HIDDEN_NOTICE } from '@/lib/results/kinds';
import { COPY } from '@/lib/copy';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { coverProxyUrl } from '@/lib/media/cover-url';
import ProfileCoverHeader from '@/components/profile/ProfileCoverHeader';
import ProfileCornerControl from '@/components/profile/ProfileCornerControl';
import { useAuth } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/Toast';
import LazyImage from '@/components/LazyImage';
import ProfileMediaTabs from '@/components/ProfileMediaTabs';
import FeaturedPosts from '@/components/FeaturedPosts';
import StatementsRail from '@/components/StatementsRail';
import SportQuickLinks from '@/components/SportQuickLinks';
import ProfileSports from '@/components/profile/ProfileSports';
import ProfileSocialLinks from '@/components/profile/ProfileSocialLinks';
import type { SportSkillCard } from '@/lib/sports/server/types';
import ProfilePhotoViewer from '@/components/profile/ProfilePhotoViewer';
import type { ProfilePhotoSlot } from '@/lib/profiles/photo-paths';
import PostDetailModal from '@/components/PostDetailModal';
import AppHeader from '@/components/AppHeader';

// Heavy / rarely-open modals — split into their own chunks. Cuts First Load
// JS on /athlete (~257 kB → lighter, modals fetch on open).
const EditProfileTabs = dynamic(() => import('@/components/EditProfileTabs'), { ssr: false });
const CreatePostModal = dynamic(() => import('@/components/CreatePostModal'), { ssr: false });
const PerformanceModal = dynamic(() => import('@/components/PerformanceModal'), { ssr: false });
const FollowersModal = dynamic(() => import('@/components/FollowersModal'), { ssr: false });
import type { Performance } from '@/lib/supabase';
import AchievementPills from '@/components/achievements/AchievementPills';
import OrgMembershipsStrip from '@/components/affiliations/OrgMembershipsStrip';
import { topPills } from '@/lib/achievements/display';
import type { Achievement } from '@/lib/achievements';
import {
  formatDisplayName,
  getInitials,
} from '@/lib/formatters';
import { getHandle } from '@/lib/profile-display';


export default function AthleteProfilePage() {
  const { user, profile, loading, refreshProfile, initialAuthCheckComplete } = useAuth();
  const router = useRouter();
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  // null = not yet resolved. The skill-cards section renders ABOVE the media
  // tabs, so it must be in the layout before ProfileMediaTabs mounts — its
  // ?tab= deep-link scroll runs at mount, and content appearing above it
  // afterwards pushed the strip out of the phone viewport (caught by
  // training-mobile.spec).
  const [skillCards, setSkillCards] = useState<SportSkillCard[] | null>(null);
  
  // Modal states
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isPerformanceModalOpen, setIsPerformanceModalOpen] = useState(false);
  const [editingPerformance] = useState<Performance | undefined>();
  const { showNotice, showError } = useToast();
  
  // Create Post Modal state
  const [isCreatePostModalOpen, setIsCreatePostModalOpen] = useState(false);
  // Create → Sport (Oct 13 2026): open with the sport picker showing.
  const [composerPickSport, setComposerPickSport] = useState(false);

  // Posts count for stats display
  const [postsCount, setPostsCount] = useState(0);
  // counts.all is media-only since migration 074; statements feed the rail.
  const [statementsCount, setStatementsCount] = useState(0);

  // Media refresh trigger
  const [mediaRefreshKey, setMediaRefreshKey] = useState(0);
  // ?post= deep link target (own-profile share links).
  const [openPostId, setOpenPostId] = useState<string | null>(null);
  // ?tab= deep link (e.g. ?tab=training) — read before ProfileMediaTabs mounts
  // (the loading gates above guarantee that), validated inside the component.
  const [deepLinkTab, setDeepLinkTab] = useState<string | null>(null);
  // ?sport= companion for ?tab=stats — the hub's sport layer. Kept in state
  // so the key={mediaRefreshKey} remounts restore the current chip.
  const [deepLinkSport, setDeepLinkSport] = useState<string | null>(null);
  // ?edit=sport deep link (GetStartedCard "Set level →"): opens Edit Profile
  // on the Sports tab (Program D — one tab, the setup as steps). Held
  // pending until the profile is known so the editor seeds from it.
  const [pendingEditDeepLink, setPendingEditDeepLink] = useState(false);
  const [editInitialTab, setEditInitialTab] = useState<string | null>(null);

  // Follow stats
  const [followersCount, setFollowersCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);

  // Followers Modal state
  const [isFollowersModalOpen, setIsFollowersModalOpen] = useState(false);
  const [followersModalTab, setFollowersModalTab] = useState<'followers' | 'following'>('followers');

  // Redirect to auth if not logged in
  useEffect(() => {
    if (!loading && !user) {
      router.push('/');
    }
  }, [user, loading, router]);

  // ?post= deep link (own-profile share links; also preserved through the
  // /athlete/[id] self-redirect). Mount-only window.location read — same
  // pattern as the feed's ?create=1, avoids useSearchParams' Suspense
  // requirement on this statically prerendered page.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const p = sp.get('post');
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a mount-only window.location read (a render-phase read breaks hydration on this prerendered page); the rule reports the first setState only
    if (p) setOpenPostId(p);
    const t = sp.get('tab');
    if (t) setDeepLinkTab(t);
    const s = sp.get('sport');
    if (s) setDeepLinkSport(s);
    if (sp.get('edit') === 'sport') setPendingEditDeepLink(true);
  }, []);

  // Consume the ?edit=sport deep link once the profile has loaded — the sport
  // tab id comes from profiles.sport, which isn't known at mount. Render-phase
  // state sync (house idiom, cf. EditProfileTabs' profile seeding).
  if (pendingEditDeepLink && profile) {
    setPendingEditDeepLink(false);
    setEditInitialTab('sports');
    setIsEditModalOpen(true);
  }


  const loadAthleteData = async (profileId: string, skipLoadingState = false) => {
    try {
      if (!skipLoadingState) {
        setDataLoading(true);
      }

      // Use Promise.allSettled for better error handling and faster responses
      const [achievementsResult, skillCardsResult] = await Promise.allSettled([
        fetch(`/api/achievements?profileId=${profileId}`, { credentials: 'include' })
          .then(res => (res.ok ? res.json() : { achievements: [] }))
          .then(data => (data.achievements || []) as Achievement[]),
        // The owner always sees their own fresh order (a pin answers at once).
        fetch(`/api/profile/${profileId}/skill-cards`, { cache: 'no-store' })
          .then(res => (res.ok ? res.json() : { skillCards: [] }))
          .then(data => (data.skillCards || []) as SportSkillCard[]),
      ]);

      // Update each piece of data as it becomes available
      if (achievementsResult.status === 'fulfilled') {
        setAchievements(achievementsResult.value);
      }
      // Empty on failure, never stuck at null: the media tabs wait for this.
      setSkillCards(skillCardsResult.status === 'fulfilled' ? skillCardsResult.value : []);
    } catch (e) {
      console.error('Failed to load athlete profile data:', e);
      showError('Failed to load profile data', 'Some information may not be displayed correctly.');
    } finally {
      if (!skipLoadingState) {
        setDataLoading(false);
      }
    }
  };

  const loadFollowStats = async (profileId: string) => {
    try {
      const response = await fetch(`/api/follow/stats?profileId=${profileId}`);
      if (response.ok) {
        const data = await response.json();
        setFollowersCount(data.followersCount || 0);
        setFollowingCount(data.followingCount || 0);
      } else {
        console.error('Failed to load follow stats — status:', response.status);
      }
    } catch (e) {
      console.error('Failed to load follow stats:', e);
      setFollowersCount(0);
      setFollowingCount(0);
    }
  };

  // Load athlete data (the loaders above are declared before this effect
  // reads them — the compiler's immutability rule).
  useEffect(() => {
    if (user?.id) {
      // Load critical data immediately. The loader is shared with the
      // editor's onSave, the post delete and the composer (they await / call
      // it), so it stays a handler-reachable function rather than an
      // effect-local IIFE — the eslint.config.mjs-sanctioned shape.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the shared loader (see above)
      loadAthleteData(user.id);

      // PERFORMANCE FIX: Defer follow stats to avoid blocking page render
      // Use requestIdleCallback for better performance
      const idleCallback = window.requestIdleCallback || ((cb) => setTimeout(cb, 1));
      idleCallback(() => {
        loadFollowStats(user.id);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Performance editing temporarily disabled - keeping handlers for future use
  // const handleEditPerformance = (existingData?: Performance) => {
  //   setEditingPerformance(existingData);
  //   setIsPerformanceModalOpen(true);
  // };

  const handleSavePerformance = async (data: Partial<Performance>) => {
    try {
      if (!user?.id) {
        throw new Error('User not authenticated');
      }

      const response = await fetch('/api/performances', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          performanceData: data,
          userId: user.id
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save performance');
      }

      // Show success toast  

      // Refresh the data instead of full page reload - do it in background  
      if (user?.id) {
        // Don't await - let it happen in background for faster UI response
        refreshProfile();
        loadAthleteData(user.id, true); // Skip loading state for background refresh
      }
    } catch (err) {
      // Performance save error
      const message = err instanceof Error ? err.message : 'Failed to save performance';
      showError('Failed to save performance', message);
      throw new Error(message);
    }
  };

  // Performance deletion temporarily disabled - keeping handler for future use
  // const handleDeletePerformance = async (performanceId: string) => {
  //   if (!window.confirm('Are you sure you want to delete this performance? This action cannot be undone.')) {
  //     return;
  //   }

  //   try {
  //     const response = await fetch(`/api/performances/${performanceId}`, {
  //       method: 'DELETE',
  //     });

  //     if (!response.ok) {
  //       const error = await response.json();
  //       throw new Error(error.error || 'Failed to delete performance');
  //     }

  //     // Show success toast

  //     // Refresh the data
  //     if (user?.id) {
  //       refreshProfile();
  //       loadAthleteData(user.id, true);

  //       // Also refresh performances specifically to maintain sort order
  //       AthleteService.getRecentPerformances(user.id).then(newPerformances => {
  //         setPerformances(newPerformances);
  //       }).catch((error) => {
  //         
  //       });
  //     }
  //   } catch {
  //     // Performance delete error
  //     showError('Failed to delete performance', error instanceof Error ? error.message : 'Please try again');
  //   }
  // };

  // Capture popovers off the two camera FABs (capture-everywhere round):
  // Take photo / Choose photo.
  // Profile photos (Oct 25 2026, Convention 52): a set photo is tapped to
  // view larger and edited from there; an EMPTY slot shows nothing — photos
  // are added in Edit Profile → Basic, like every other profile field.
  const [viewing, setViewing] = useState<ProfilePhotoSlot | null>(null);

  // Avatar picking/cropping/uploading lives in the shared AvatarUploader
  // (circle crop via the media editor); this just refreshes on success.


  // Show loading state during initial auth resolution
  if (loading || !initialAuthCheckComplete) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand mx-auto"></div>
          <p className="mt-4 text-secondary font-medium">Checking your session...</p>
          <p className="mt-1 text-sm text-muted">This should only take a moment</p>
        </div>
      </div>
    );
  }

  // If no user after loading is complete, don't render anything (redirect will happen)
  if (!user) {
    return null;
  }

  // Show the UI even while data is loading - progressive loading approach
  // Only show skeleton if we have no profile data at all
  if (dataLoading && !profile) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand mx-auto"></div>
          <p className="mt-4 text-secondary font-medium">Loading your profile...</p>
          <p className="mt-1 text-sm text-muted">Getting everything ready</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas">
      {/* Unified Header */}
      <AppHeader
        showSearch={false}
        onCreatePost={() => setIsCreatePostModalOpen(true)}
        onCreateSport={() => { setComposerPickSport(true); setIsCreatePostModalOpen(true); }}
        onEditProfile={() => setIsEditModalOpen(true)}
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-8">
        {/* Profile Header Section */}
        <div className="bg-surface rounded-lg shadow-sm border border-border overflow-hidden mb-6 sm:mb-8">
          {/* Cover photo (3:1, cropped in the media editor; gradient until set)
              with the profile picture half over its bottom edge. */}
          <ProfileCoverHeader
            coverSrc={coverProxyUrl(profile?.id, profile?.cover_url)}
            size="lg"
            rowClassName="px-4 sm:px-6 lg:px-8 flex justify-center sm:justify-start"
            overlay={
              /* The owner's corner (Oct 14 2026): Edit profile — the same editor
                 as the header menu's entry, one tap from the cover. The ONLY
                 owner control on the header (Convention 52). */
              <ProfileCornerControl mode="owner" onEdit={() => setIsEditModalOpen(true)} />
            }
            onCoverTap={profile?.cover_url ? () => setViewing('cover') : undefined}
            onAvatarTap={profile?.avatar_url ? () => setViewing('avatar') : undefined}
          >
            <LazyImage
              src={profile?.avatar_url}
              alt={`${formatDisplayName(profile?.first_name, null, profile?.last_name, profile?.full_name)} avatar`}
              className="w-32 h-32 sm:w-40 sm:h-40 lg:w-48 lg:h-48 rounded-full object-cover border-4 border-white dark:border-surface shadow-lg"
              width={192}
              height={192}
              priority
              fallback={
                <div
                  className="w-32 h-32 sm:w-40 sm:h-40 lg:w-48 lg:h-48 rounded-full bg-gradient-to-br from-violet-500 to-violet-600 flex items-center justify-center border-4 border-white dark:border-surface shadow-lg"
                  role="img"
                  aria-label={`${formatDisplayName(profile?.first_name, null, profile?.last_name, profile?.full_name)} avatar`}
                >
                  <span className="text-white font-bold text-4xl sm:text-5xl" aria-hidden="true">
                    {getInitials(formatDisplayName(profile?.first_name, null, profile?.last_name, profile?.full_name))}
                  </span>
                </div>
              }
            />
          </ProfileCoverHeader>
          <div className="p-4 sm:p-6 lg:p-8">
            <div className="flex flex-col sm:flex-row items-start gap-4 sm:gap-6 lg:gap-8">
              {/* Profile Information */}
              <div className="flex-1 min-w-0">
                <div className="mb-6">
                  <h1 className="text-3xl sm:text-4xl font-bold text-primary mb-2 break-words">
                    {formatDisplayName(profile?.first_name, null, profile?.last_name, profile?.full_name)}
                  </h1>
                  {profile && getHandle(profile) && (
                    <p className="text-xl text-muted mb-2">
                      {getHandle(profile)}
                    </p>
                  )}
                  {profile?.user_type === 'organizer' && (
                    <span className="inline-flex items-center gap-2 rounded-full bg-brand-soft px-3 py-1 text-xs font-semibold text-brand-fg-strong mb-2">
                      <i className="fas fa-building" aria-hidden="true"></i> Organizer account
                    </span>
                  )}

                  {/* Top achievements — real athlete_achievements rows, the
                      same source as the Achievements tab (no fabricated
                      sample badges, ever) */}
                  {achievements.length > 0 && (
                    <div className="mb-4">
                      <AchievementPills pills={topPills(achievements, 4)} />
                    </div>
                  )}

                  {/* Clubs & Leagues memberships (org connections round) —
                      self-fetching, renders nothing when empty. */}
                  {profile?.id && (
                    <div className="mb-4">
                      <OrgMembershipsStrip profileId={profile.id} />
                    </div>
                  )}

                  {/* Quick links to the sport's dedicated pages (rounds,
                      trends) — adapter-declared, renders nothing for sports
                      without them. Own-profile only: these are YOUR stats. */}
                  {profile?.sport && (
                    <div className="mb-4">
                      <SportQuickLinks sport={profile.sport} />
                    </div>
                  )}

                  {/* Compact per-sport strip (Stats Hub round) — the full
                      cards live inside the Stats tab now; a row tap opens
                      that sport's hub layer. Data resolved by
                      loadAthleteData, same load path as before, so the
                      ProfileMediaTabs layout-settle gate is unchanged. */}
                  {profile?.id && skillCards !== null && (
                    <div className="mb-4">
                      <ProfileSports
                        cards={skillCards}
                        isOwner
                        onCardsChange={setSkillCards}
                        onOpenSport={(sportKey) => {
                          setDeepLinkTab('stats');
                          setDeepLinkSport(sportKey);
                          window.history.replaceState(null, '', `/athlete?tab=stats&sport=${sportKey}`);
                          // Remount the tabs: a deep-linked mount runs the
                          // #334 pin scroll, landing the viewer on the hub.
                          setMediaRefreshKey(k => k + 1);
                        }}
                      />
                    </div>
                  )}

                  {/* Biography — read-only; edited in Edit Profile → Basic */}
                  {profile?.bio && (
                    <div className="text-primary leading-relaxed mb-4 block">{profile.bio}</div>
                  )}
                  
                  {/* Stats Row — Fans, Following, Posts (Tom's order) */}
                  <div className="flex items-center gap-6 text-sm">
                    <button
                      onClick={() => {
                        setFollowersModalTab('followers');
                        setIsFollowersModalOpen(true);
                      }}
                      className="flex items-center gap-1 min-h-[44px] -my-3 text-tertiary hover:text-brand-fg transition-colors"
                    >
                      <span className="font-semibold text-primary">{followersCount}</span>
                      <span>Fans</span>
                    </button>
                    <button
                      onClick={() => {
                        setFollowersModalTab('following');
                        setIsFollowersModalOpen(true);
                      }}
                      className="flex items-center gap-1 min-h-[44px] -my-3 text-tertiary hover:text-brand-fg transition-colors"
                    >
                      <span className="font-semibold text-primary">{followingCount}</span>
                      <span>Following</span>
                    </button>
                    <div className="flex items-center gap-1 text-tertiary">
                      <span className="font-semibold text-primary">{postsCount}</span>
                      <span>Posts</span>
                    </div>
                  </div>

                  {/* Social links — the visitor's rendering (ProfileSocialLinks);
                      the handles are edited in Edit Profile → Socials. */}
                  <ProfileSocialLinks profile={profile} rowClassName="flex flex-wrap items-center gap-4 sm:gap-6 mt-4" />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Main content */}
        <div className="space-y-8">
          {/* Media Tabs (scroll-mt clears the sticky AppHeader) */}
          <div id="media-section" className="bg-surface rounded-lg shadow-md p-4 sm:p-6 scroll-mt-20">
            {/* flex-wrap: title + Create Post is ~340px, over a 320px screen */}
            <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
              <h2 className="text-2xl font-bold text-black dark:text-primary">My Media</h2>
              <button
                onClick={() => setIsCreatePostModalOpen(true)}
                className="bg-brand text-white px-4 py-2 rounded-lg hover:bg-brand-hover transition-colors flex items-center gap-2"
              >
                <i className="fas fa-plus"></i>
                Create Post
              </button>
            </div>
            <FeaturedPosts
              profileId={user?.id || ''}
              isOwnProfile={true}
              currentUserId={user?.id}
              refreshKey={mediaRefreshKey}
            />
            <StatementsRail
              profileId={user?.id || ''}
              currentUserId={user?.id}
              totalCount={statementsCount}
              refreshKey={mediaRefreshKey}
            />
            {/* Mounted only after the skill-cards section above has resolved:
                the ?tab= deep-link scroll runs at THIS component's mount, and
                any content inserted above it later shifts the strip out of
                the phone viewport (training-mobile.spec pins this). */}
            {skillCards !== null && <ProfileMediaTabs
              key={mediaRefreshKey}
              profileId={user?.id || ''}
              currentUserId={user?.id}
              isOwnProfile={true}
              initialTab={deepLinkTab ?? undefined}
              skillCards={skillCards ?? undefined}
              initialSport={deepLinkSport}
              onSportChange={(sportKey) => {
                // Same mirror discipline as tabs: shareable, refresh-stable,
                // remount-stable (/athlete?tab=stats&sport=golf).
                setDeepLinkSport(sportKey);
                window.history.replaceState(
                  null,
                  '',
                  sportKey ? `/athlete?tab=stats&sport=${sportKey}` : '/athlete?tab=stats'
                );
              }}
              onTabChange={(tab) => {
                // Mirror the tab into the URL (no navigation) so the state is
                // shareable / refresh-stable: /athlete?tab=training. Also keep it
                // in deepLinkTab: key={mediaRefreshKey} remounts this component
                // after a post-create, and initialTab is what survives that.
                // Leaving stats drops the sport param with the tab.
                setDeepLinkTab(tab === 'all' ? null : tab);
                if (tab !== 'stats') setDeepLinkSport(null);
                window.history.replaceState(null, '', tab === 'all' ? '/athlete' : `/athlete?tab=${tab}`);
              }}
              onCountsChange={(counts) => {
                setPostsCount(counts.all);
                setStatementsCount(counts.statements ?? 0);
              }}
            />}
          </div>
        </div>
      </div>

      {/* Edit Profile Modal */}
      <EditProfileTabs
        isOpen={isEditModalOpen}
        onClose={() => {
          setIsEditModalOpen(false);
          setEditInitialTab(null); // deep-link tab applies to that open only
        }}
        initialTab={editInitialTab ?? undefined}
        profile={profile}
        // Save returns to the read-only profile (Convention 52): the editor
        // closes itself through its dirty check, so typing left on ANOTHER
        // tab asks before it is lost — the same door as Close.
        closeOnSave
        onSave={async () => {
          // The modal has already re-read the shared profile (useAuth);
          // this page's own data (stats, achievements, cards) follows.
          if (user?.id) await loadAthleteData(user.id);
        }}
      />
      
      {/* Toast Container */}

      {/* One modal serves both the ?post= deep link and sport-card clicks */}
      <PostDetailModal
        postId={openPostId}
        isOpen={!!openPostId}
        onClose={() => {
          setOpenPostId(null);
          if (window.location.search.includes('post=')) {
            window.history.replaceState(null, '', '/athlete');
          }
        }}
        currentUserId={user?.id}
        // Without onDelete the owner's trash renders and silently no-ops.
        onDelete={async (postId, mode) => {
          try {
            const response = await fetch(`/api/posts?postId=${postId}${mode === 'delete' ? '&mode=delete' : ''}`, {
              method: 'DELETE',
              credentials: 'include',
            });
            if (!response.ok) {
              const errorData = await response.json().catch(() => ({}));
              throw new Error(errorData.error || 'Failed to delete post');
            }
            setOpenPostId(null);
            if (window.location.search.includes('post=')) {
              window.history.replaceState(null, '', '/athlete');
            }
            if (user?.id) loadAthleteData(user.id, true);
            // Results-kept (241): a result comes back hidden, not deleted.
            const body = await response.json().catch(() => ({}));
            if (body.hidden) showNotice('Hidden from your profile', HIDDEN_NOTICE);
            else if (body.deleted) showNotice(COPY.FORMS.DELETED_RESULT_TITLE, COPY.FORMS.DELETED_RESULT_BODY);
          } catch (e) {
            console.error('Failed to delete post:', e);
            // The server's own words when it has some (a refusal names its reason).
            showError('Error', e instanceof Error && e.message ? e.message : 'Failed to delete post');
          }
        }}
      />

      {/* Performance Modal */}
      <PerformanceModal
        isOpen={isPerformanceModalOpen}
        onClose={() => setIsPerformanceModalOpen(false)}
        existingData={editingPerformance}
        onSave={handleSavePerformance}
      />

      {viewing && profile && (
        <ProfilePhotoViewer
          slot={viewing}
          src={viewing === 'avatar' ? (profile.avatar_url as string) : (coverProxyUrl(profile.id, profile.cover_url) as string)}
          alt={viewing === 'avatar' ? 'Profile picture' : 'Cover photo'}
          canEdit
          profileId={profile.id}
          current={viewing === 'avatar'
            ? { sourceUrl: profile.avatar_source_url ?? null, recipe: profile.avatar_recipe ?? null }
            : { sourceUrl: profile.cover_source_url ?? null, recipe: profile.cover_recipe ?? null }}
          onChanged={() => refreshProfile()}
          onClose={() => setViewing(null)}
        />
      )}

      {/* Create Post Modal */}
      <CreatePostModal
        isOpen={isCreatePostModalOpen}
        onClose={() => { setIsCreatePostModalOpen(false); setComposerPickSport(false); }}
        userId={user?.id || ''}
        // A new post starts as a plain General post (Tom, Oct 10 2026) —
        // never the athlete's own sport; the sport picker is one tap away
        // (or already open, from Create → Sport).
        defaultSportKey="general"
        openSportPicker={composerPickSport}
        onPostCreated={() => {
          // Refresh athlete data
          if (user?.id) {
            loadAthleteData(user.id, true);
          }
          // Trigger media refresh by changing the key
          setMediaRefreshKey(prev => prev + 1);
          setIsCreatePostModalOpen(false);
        }}
      />

      {/* Followers/Following Modal */}
      <FollowersModal
        isOpen={isFollowersModalOpen}
        onClose={() => setIsFollowersModalOpen(false)}
        profileId={user?.id || ''}
        initialTab={followersModalTab}
      />
    </div>
  );
}
