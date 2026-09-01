'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import ResumeOrgClaimBanner from '@/components/orgs/ResumeOrgClaimBanner';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import { AvatarImage } from '@/components/OptimizedImage';
import NotificationBell from '@/components/NotificationBell';
import MessagesBell from '@/components/messages/MessagesBell';
import HeaderSearch from '@/components/HeaderSearch';
import { FEATURE_FLAGS } from '@/lib/features';
import { useLiveNow } from '@/hooks/useLiveNow';
import { useTheme } from '@/lib/use-theme';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { usePopoverDismiss } from '@/hooks/usePopoverDismiss';
import { pillGeometry, activeNavIndex, type ItemBox } from '@/lib/nav-pill';

/**
 * Last known pill geometry, kept at MODULE level on purpose.
 *
 * Every page mounts its own AppHeader (it is not in the root layout), so the
 * header REMOUNTS on every navigation and component state is lost. Without
 * this, the pill could never slide between routes — it would simply be
 * re-placed at the new position on a fresh mount, which is precisely the
 * "disappearing and reappearing" the pill exists to replace.
 *
 * Seeding the new mount with the previous position, then measuring the new one
 * a frame later, turns a remount into a slide.
 */
let lastPill: { x: number; width: number; visible: boolean } | null = null;

/**
 * The header shell, in ONE place. It was previously the same long class string
 * written out in all three auth branches, which meant a change to any of them
 * silently made the auth-booting shell a different height and the chrome
 * jumped as auth resolved.
 *
 * `scrolled` drives the bottom border: at the very top the header should read
 * as part of the page, and the edge only earns its keep once content is
 * passing underneath it.
 *
 * `top` is a CSS variable, not 0: the guardian/transfer banners (StickyBanner)
 * publish their measured height as `--ea-banner-h` on <html>. Both the banner
 * and the header are sticky, and when both pinned at top:0 the banner's higher
 * z-index buried the header — logo, search, bells and hamburger all vanished
 * behind a 40px strip once the page scrolled. With the offset the header docks
 * *below* the banner instead. No banner → the variable is unset → top:0.
 */
const headerShell = (scrolled: boolean) =>
  `sticky top-[var(--ea-banner-h,0px)] z-40 safe-top safe-x bg-surface/80 backdrop-blur-md transition-[border-color,box-shadow] duration-200 border-b ${
    scrolled ? 'border-[color:var(--ea-hairline)] shadow-[var(--ea-shadow-rest)]' : 'border-transparent shadow-none'
  }`;

interface NavLink {
  path: string;
  label: string;
  icon: string;
  /** Live gets its own treatment (the status dot). */
  accent?: 'live';
  /** Reachable from the icon cluster on desktop; drawer-only in the nav list. */
  iconOnly?: boolean;
}

interface AppHeaderProps {
  /**
   * @deprecated Search now lives IN the bar (see HeaderSearch), so there is no
   * band to show or hide. Accepted and ignored so the 24 existing call sites
   * keep compiling; remove them in a follow-up sweep.
   */
  showSearch?: boolean;
  onCreatePost?: () => void;
  onEditProfile?: () => void;
}

export default function AppHeader({ onCreatePost, onEditProfile }: AppHeaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, initialAuthCheckComplete, profile, signOut, managedProfiles, activeProfile, setActiveProfile } = useAuth();
  const { theme, toggleNow: toggleTheme } = useTheme();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isProfileDropdownOpen, setIsProfileDropdownOpen] = useState(false);
  // Orgs the user manages (phase 1) — LAZY on first menu open so the
  // header adds no request to ordinary page loads. null = not yet loaded;
  // [] = loaded, none (the section hides itself).
  const [managedOrgs, setManagedOrgs] = useState<
    { kind: 'league' | 'club'; id: string; name: string }[] | null
  >(null);
  useEffect(() => {
    if (!user?.id || managedOrgs !== null) return;
    if (!isProfileDropdownOpen && !isMobileMenuOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/profile/${user.id}/organizations`);
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (!cancelled) {
          const all = (data.organizations ?? []) as { kind: 'league' | 'club'; id: string; name: string; role: string }[];
          setManagedOrgs(all.filter(o => o.role === 'owner' || o.role === 'manager').slice(0, 3));
        }
      } catch {
        if (!cancelled) setManagedOrgs([]);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, managedOrgs, isProfileDropdownOpen, isMobileMenuOpen]);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const closeProfileDropdown = useCallback(() => setIsProfileDropdownOpen(false), []);
  usePopoverDismiss(profileMenuRef, isProfileDropdownOpen, closeProfileDropdown);
  const [scrolled, setScrolled] = useState(false);

  // Passive listener reading only scrollY — no getBoundingClientRect, so this
  // never forces a layout during scroll. One boolean, so React bails on the
  // vast majority of scroll events rather than re-rendering the header.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // The drawer is a full-height overlay: lock the page behind it (iOS
  // otherwise scrolls/rubber-bands the page under the backdrop) and close on
  // Escape, scoped to the drawer's lifetime like HeaderSearch does.
  useBodyScrollLock(isMobileMenuOpen);

  useEffect(() => {
    if (!isMobileMenuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setIsMobileMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isMobileMenuOpen]);

  const handleSignOut = async () => {
    await signOut();
    // Note: signOut() handles the redirect, no need to router.push
  };

  const handleCreatePost = () => {
    if (onCreatePost) {
      onCreatePost();
    } else {
      // Pages without their own composer mount (explore, live, messages,
      // calendar, settings…) hand off to the feed's ?create=1 deep link —
      // the same battle-tested path the rounds page and onboarding CTA use.
      // The old /athlete fallback silently navigated instead of composing.
      router.push('/feed?create=1');
    }
    setIsMobileMenuOpen(false);
  };

  const isActivePath = (path: string) => {
    if (path === '/feed') return pathname === '/feed';
    if (path === '/athlete') return pathname === '/athlete' || pathname?.startsWith('/athlete/');
    if (path === '/messages') return pathname === '/messages' || pathname?.startsWith('/messages/');
    if (path === '/notifications') return pathname === '/notifications';
    // A round page IS the Live section; exact-match left the tab dark while
    // you were literally watching a live round.
    if (path === '/live') return pathname === '/live' || pathname?.startsWith('/live/');
    return pathname === path;
  };

  // The destinations, without Live — it gets inserted at the midpoint below.
  const placeLinks: NavLink[] = [
    { path: '/feed', label: 'Feed', icon: 'fa-home' },
    { path: '/explore', label: 'Explore', icon: 'fa-compass' },
    { path: '/calendar', label: 'Calendar', icon: 'fa-calendar-alt' },
    { path: '/athlete', label: 'Profile', icon: 'fa-user' },
  ];

  // Live sits in the MIDDLE of the nav. Computed rather than hard-coded because
  // Calendar is flag-gated — the nav is 4 items in production and 5 with the
  // flag on, so a fixed index would centre Live in one environment and not the
  // other. `ceil` keeps Feed and Explore together on the 4-item nav.
  const navLinks: NavLink[] = [
    ...placeLinks.toSpliced(Math.ceil(placeLinks.length / 2), 0, {
      path: '/live',
      label: 'Live',
      icon: 'fa-circle',
      accent: 'live' as const,
    }),
    // `iconOnly` = reachable from the icon cluster on desktop, so the nav
    // doesn't say it twice. They STAY in this array because the mobile drawer
    // renders from it and, below `lg`, the drawer is the only route to them —
    // dropping them here would make Connections unreachable on a phone.
    // (This replaces a `hideOnMobile` flag that nothing ever read.)
    { path: '/messages', label: 'Messages', icon: 'fa-comment-alt', iconOnly: true },
    { path: '/app/followers', label: 'Connections', icon: 'fa-user-friends', iconOnly: true },
  ];

  /** What the desktop nav shows: the places, not the tools. */
  const desktopNavLinks = navLinks.filter(link => !link.iconOnly);

  // ── Sliding pill ──────────────────────────────────────────────────────────
  // One absolutely-positioned element whose transform/width come from the
  // MEASURED box of the active item. No animation library: a CSS transition
  // does the sliding, which also means the global prefers-reduced-motion rule
  // neutralises it for free.
  // Gated on user: the endpoint is authenticated, and this header also
  // renders for signed-out visitors on public pages (/u, /explore).
  const liveCount = useLiveNow(!!user);
  const navRef = useRef<HTMLElement | null>(null);
  const itemRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const [pill, setPill] = useState(lastPill ?? { x: 0, width: 0, visible: false });
  // Transitions are OFF for the first placement. Without this the pill would
  // animate in from x=0/width=0 on every page load, which reads as a glitch
  // rather than as motion.
  const [pillReady, setPillReady] = useState(lastPill !== null);

  const activeIndex = activeNavIndex(
    desktopNavLinks.map(l => l.path),
    pathname,
    (path, current) => isActivePath(path) && current.length > 0
  );

  const measurePill = useCallback(() => {
    const boxes: Array<ItemBox | null> = desktopNavLinks.map((_, i) => {
      const el = itemRefs.current[i];
      return el ? { left: el.offsetLeft, width: el.offsetWidth } : null;
    });
    const next = pillGeometry(boxes, activeIndex);
    lastPill = next;
    setPill(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, desktopNavLinks.length]);

  useLayoutEffect(() => {
    measurePill();
  }, [measurePill]);

  useEffect(() => {
    // Enable sliding only AFTER the first placement has painted.
    const id = requestAnimationFrame(() => setPillReady(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const onResize = () => measurePill();
    window.addEventListener('resize', onResize);
    // Label widths shift when Inter finishes loading, which would otherwise
    // leave the pill measured against fallback-font metrics.
    document.fonts?.ready.then(measurePill).catch(() => {});
    return () => window.removeEventListener('resize', onResize);
  }, [measurePill]);

  // While auth state resolves: a logo-only shell with the same height, so
  // public pages (/explore, /u/[username]) don't flash the wrong chrome.
  if (!initialAuthCheckComplete) {
    return (
      <header className={headerShell(scrolled)}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center h-16">
            <Image
              src="/logo.png"
              alt="Edge Athlete"
              width={140}
              height={35}
              preload
              className="light-theme-only h-7 w-auto"
            />
            <Image
              src="/logo-dark.png"
              alt="Edge Athlete"
              width={140}
              height={35}
              className="dark-theme-only h-7 w-auto"
            />
          </div>
        </div>
      </header>
    );
  }

  // Logged-out visitors (public pages) get sign-in chrome instead of the
  // authenticated nav: no bells (they'd poll protected APIs), no Post
  // button, no empty avatar or Sign Out — just the way in.
  if (!user) {
    return (
      <header className={headerShell(scrolled)}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-16 gap-4">
            <Link
              href="/"
              className="flex items-center min-h-[44px] hover:opacity-80 transition-opacity whitespace-nowrap"
              aria-label="Edge Athlete — go to sign in"
            >
              <Image
                src="/logo.png"
                alt="Edge Athlete"
                width={140}
                height={35}
                preload
                className="light-theme-only h-7 w-auto"
              />
              <Image
                src="/logo-dark.png"
                alt="Edge Athlete"
                width={140}
                height={35}
                className="dark-theme-only h-7 w-auto"
              />
            </Link>
            <div className="flex items-center gap-2 sm:gap-3">
              <HeaderSearch />
              {/* 36px pills in a 64px header: min-h grows Log in's hit box
                  outright; Sign up's painted gradient must stay 36px, so it
                  gets the invisible extender instead (recipes in globals.css
                  next to .ea-icon-btn). */}
              <Link href="/" className="ea-interactive inline-flex min-h-[44px] items-center text-sm font-medium text-secondary rounded-lg px-3 py-2">
                Log in
              </Link>
              <Link
                href="/"
                className="ea-cta relative after:absolute after:content-[''] after:-inset-y-1 after:inset-x-0 text-white px-3 sm:px-4 py-2 rounded-lg text-sm font-medium"
              >
                Sign up
              </Link>
            </div>
          </div>
        </div>
      </header>
    );
  }

  return (
    <>
      <ResumeOrgClaimBanner />
      {/* Desktop & Tablet Header */}
      <header className={headerShell(scrolled)}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-16">
            {/* Left - Logo & Navigation */}
            <div className="flex items-center gap-6 flex-1 min-w-0">
              <button
                onClick={() => router.push('/feed')}
                className="flex items-center min-h-[44px] shrink-0 hover:opacity-80 transition-opacity whitespace-nowrap"
                aria-label="Edge Athlete — go to feed"
              >
                {/* The wordmark is a hard 112px at h-7 — over a third of a
                    320px screen. Below `sm` the square mark carries the
                    identity in 32px so the icon cluster on the right actually
                    fits (see the width budget on that cluster below). */}
                <Image
                  src="/logo-mark.png"
                  alt="Edge Athlete"
                  width={64}
                  height={64}
                  className="h-8 w-8 sm:hidden"
                />
                <Image
                  src="/logo.png"
                  alt="Edge Athlete"
                  width={140}
                  height={35}
                  preload
                  className="light-theme-only hidden h-7 w-auto sm:block"
                />
                <Image
                  src="/logo-dark.png"
                  alt="Edge Athlete"
                  width={140}
                  height={35}
                  className="dark-theme-only hidden h-7 w-auto sm:block"
                />
              </button>

              {/* Desktop Navigation.
                  Breakpoint is `lg` (1024px), NOT `md`: the full header — logo +
                  7 nav links + 3 icon buttons + Post + the account menu — needs
                  ~834px. At md (768px, iPad portrait) it overflowed the viewport
                  by 66px and pushed the account menu off-screen entirely, which
                  also made Sign Out unreachable. 768–1023px uses the drawer,
                  which carries every one of these destinations. */}
              <nav ref={navRef} className="hidden lg:flex relative items-center gap-1">
                {/* The pill sits BEHIND the labels and slides between them.
                    aria-hidden: it is decoration — aria-current on the active
                    link is what actually conveys "you are here". */}
                <span
                  aria-hidden="true"
                  className={`pointer-events-none absolute left-0 top-1/2 h-9 -translate-y-1/2 rounded-lg bg-[color:var(--color-brand-soft)] ${
                    pillReady ? 'transition-[transform,width,opacity] duration-[250ms] ease-[cubic-bezier(0.22,0.61,0.36,1)]' : ''
                  } ${pill.visible ? 'opacity-100' : 'opacity-0'}`}
                  style={{ transform: `translateX(${pill.x}px)`, width: `${pill.width}px` }}
                />
                {desktopNavLinks.map((link, index) => {
                  const active = isActivePath(link.path);
                  // after: extender, not padding: the h-9 sliding pill and the
                  // hover bg are sized to the painted 36px link.
                  return (
                    <Link
                      key={link.path}
                      href={link.path}
                      ref={(el: HTMLAnchorElement | null) => { itemRefs.current[index] = el; }}
                      onClick={() => setIsProfileDropdownOpen(false)}
                      aria-current={active ? 'page' : undefined}
                      className={`relative z-10 after:absolute after:content-[''] after:-inset-y-1 after:inset-x-0 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-[150ms] ${
                        active
                          ? 'text-brand-fg-strong'
                          : 'text-secondary hover:text-primary hover:bg-[color:var(--ea-tint)]'
                      }`}
                    >
                      {link.accent === 'live' && (
                        // Truthful now: the dot only pulses when something is
                        // genuinely live. It used to pulse permanently from a
                        // static literal, which made it decoration pretending
                        // to be status.
                        <span
                          className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle ${
                            liveCount > 0 ? 'bg-red-600 ea-live-dot' : 'bg-gray-400'
                          }`}
                        />
                      )}
                      {link.label}
                    </Link>
                  );
                })}
              </nav>
            </div>

            {/* Right - Actions.
                Width budget at 320px (288px inside px-4): logo mark 32 +
                search trigger ~44 + two bells at 40 + Post ~36 + hamburger 40
                + five gap-1.5 ≈ 260px. Every flex item carries `shrink-0` at
                the call site — never on `.ea-icon-btn` itself (see the
                globals.css note on why that class must not own layout) —
                because `min-width:auto` otherwise lets the 40px circles
                silently squash into sub-target ellipses on 375–414px phones. */}
            <div className="flex items-center gap-1.5 sm:gap-3">
              <HeaderSearch />
              <MessagesBell />
              <NotificationBell />

              {/* Connections sits with Messages and Notifications: three
                  related destinations, one cluster. On desktop this is its
                  only home — the nav never renders it. Below `sm` it yields
                  its slot to the controls that carry unread badges; the
                  drawer (fed by navLinks) remains the phone route to it. */}
              <button
                onClick={() => router.push('/app/followers')}
                className="ea-icon-btn hidden sm:inline-flex items-center justify-center shrink-0"
                title="Fans & Connections"
                aria-label="View connections"
              >
                <i className="fas fa-user-friends text-lg"></i>
              </button>

              {/* Painted pill stays small (width budget above) — the invisible
                  after: extender carries the 44px target. -inset-y-2, not -1:
                  icon-only below sm this paints at 30px, so it needs 8px per
                  side to clear 44. */}
              <button
                onClick={handleCreatePost}
                className="ea-cta relative after:absolute after:content-[''] after:-inset-y-2 after:inset-x-0 text-white px-3 sm:px-4 py-2 rounded-lg flex shrink-0 items-center gap-2 text-sm font-medium"
                aria-label="Create new post"
              >
                <i className="fas fa-plus"></i>
                <span className="hidden sm:inline">Post</span>
              </button>

              {/* Desktop Profile Dropdown — `lg` to match the nav above. */}
              {/* Dismissal via usePopoverDismiss, NOT an invisible backdrop:
                  a fixed backdrop inside this backdrop-blur header covers only
                  the 64px strip (containing-block trap), so page-body clicks
                  never closed the menu — and it ate the first click on
                  sibling controls. The hook closes on any outside press AND
                  Escape, and lets the pressed sibling still receive its
                  click. */}
              <div ref={profileMenuRef} className="hidden lg:block relative">
                <button
                  onClick={() => setIsProfileDropdownOpen(!isProfileDropdownOpen)}
                  className="flex items-center gap-2 hover:bg-surface-sunken rounded-lg p-1.5 transition-colors"
                  aria-label="Account menu"
                  aria-expanded={isProfileDropdownOpen}
                >
                  <AvatarImage
                    src={profile?.avatar_url}
                    alt="Profile"
                    size={32}
                    fallbackInitials={getInitials(
                      formatDisplayName(profile?.first_name, null, profile?.last_name, profile?.full_name)
                    )}
                  />
                  <i className={`fas fa-chevron-down text-xs text-muted transition-transform ${isProfileDropdownOpen ? 'rotate-180' : ''}`}></i>
                </button>

                {/* Dropdown Menu */}
                {isProfileDropdownOpen && (
                  <>
                    <div className="absolute right-0 mt-2 w-64 bg-surface-raised rounded-lg shadow-lg border border-border py-2 z-20">
                      {/* Identity block IS the View Profile entry (mirrors the
                          mobile drawer's profile block) — not a static header. */}
                      <button
                        onClick={() => {
                          router.push('/athlete');
                          setIsProfileDropdownOpen(false);
                        }}
                        className="w-full text-left px-4 py-3 border-b border-border-subtle flex items-center gap-3 hover:bg-surface-muted transition-colors"
                      >
                        <AvatarImage
                          src={profile?.avatar_url}
                          alt="Profile"
                          size={32}
                          fallbackInitials={getInitials(
                            formatDisplayName(profile?.first_name, null, profile?.last_name, profile?.full_name)
                          )}
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-primary truncate">
                            {formatDisplayName(profile?.first_name, null, profile?.last_name, profile?.full_name)}
                          </p>
                          <p className="text-xs text-muted mt-0.5">View Profile</p>
                        </div>
                      </button>

                      {/* Guardian-profiles: in-session switching to managed
                          athletes. Authorization is the profile_access row,
                          re-checked server-side on every write. */}
                      {FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES && (
                        <div className="py-1 border-b border-border-subtle">
                          <p className="px-4 pt-1 pb-0.5 text-[10px] font-semibold text-faint uppercase tracking-wide">
                            Your athletes
                          </p>
                          {managedProfiles.map(mp => (
                            <button
                              key={mp.id}
                              onClick={() => {
                                setActiveProfile(activeProfile?.id === mp.id ? null : mp);
                                setIsProfileDropdownOpen(false);
                              }}
                              className="w-full text-left px-4 py-2 text-sm text-secondary hover:bg-surface-muted flex items-center gap-3"
                            >
                              <i className={`fas ${activeProfile?.id === mp.id ? 'fa-circle-check text-brand-fg' : 'fa-child-reaching'} w-4`}></i>
                              <span>
                                {formatDisplayName(mp.first_name, null, mp.last_name, mp.full_name)}
                                {activeProfile?.id === mp.id && (
                                  <span className="ml-1 text-xs text-brand-fg">(active)</span>
                                )}
                              </span>
                            </button>
                          ))}
                          {/* One door to the management surface — approvals
                              and transfers live inside the console now.
                              Round J: parents keep the door even with an
                              empty roster (a "Skip for now" on add-athlete
                              used to strand them with no way back). */}
                          {(managedProfiles.length > 0 || profile?.user_type === 'parent') && (
                            <button
                              onClick={() => {
                                router.push('/app/guardian');
                                setIsProfileDropdownOpen(false);
                              }}
                              className="w-full text-left px-4 py-2 text-sm text-brand-fg-strong hover:bg-brand-soft flex items-center gap-3"
                            >
                              <i className="fas fa-people-roof w-4"></i>
                              <span>Family console</span>
                            </button>
                          )}
                          <button
                            onClick={() => {
                              router.push('/app/guardian/add-athlete');
                              setIsProfileDropdownOpen(false);
                            }}
                            className="w-full text-left px-4 py-2 text-sm text-brand-fg-strong hover:bg-brand-soft flex items-center gap-3"
                          >
                            <i className="fas fa-plus w-4"></i>
                            <span>Add an athlete</span>
                          </button>
                        </div>
                      )}

                      {/* Orgs the user manages (phase 1) — the Family
                          console pattern: a console door per managed org. */}
                      {managedOrgs !== null && managedOrgs.length > 0 && (
                        <div className="py-1 border-b border-border-subtle">
                          <p className="px-4 pt-1 pb-0.5 text-[10px] font-semibold text-faint uppercase tracking-wide">
                            Your organizations
                          </p>
                          {managedOrgs.map(org => (
                            <button
                              key={`${org.kind}:${org.id}`}
                              onClick={() => {
                                router.push(`/app/org/${org.kind}/${org.id}`);
                                setIsProfileDropdownOpen(false);
                              }}
                              className="w-full text-left px-4 py-2 text-sm text-secondary hover:bg-surface-muted flex items-center gap-3"
                            >
                              <i className={`fas ${org.kind === 'league' ? 'fa-trophy' : 'fa-building'} w-4`}></i>
                              <span className="truncate">Manage {org.name}</span>
                            </button>
                          ))}
                        </div>
                      )}

                      <div className="py-1">
                        <button
                          onClick={() => {
                            if (onEditProfile) {
                              onEditProfile();
                            } else {
                              router.push('/athlete');
                            }
                            setIsProfileDropdownOpen(false);
                          }}
                          className="w-full text-left px-4 py-2 text-sm text-secondary hover:bg-surface-muted flex items-center gap-3"
                        >
                          <i className="fas fa-edit w-4"></i>
                          <span>Edit Profile</span>
                        </button>
                        <button
                          onClick={() => {
                            router.push('/athlete/saved');
                            setIsProfileDropdownOpen(false);
                          }}
                          className="w-full text-left px-4 py-2 text-sm text-secondary hover:bg-surface-muted flex items-center gap-3"
                        >
                          <i className="fas fa-bookmark w-4"></i>
                          <span>Saved Posts</span>
                        </button>
                        <button
                          onClick={() => {
                            router.push('/settings');
                            setIsProfileDropdownOpen(false);
                          }}
                          className="w-full text-left px-4 py-2 text-sm text-secondary hover:bg-surface-muted flex items-center gap-3"
                        >
                          <i className="fas fa-cog w-4"></i>
                          <span>Settings</span>
                        </button>
                        {/* Quick theme flip. Deliberately does NOT close the
                            dropdown: the visible flip is the feedback. In
                            Scheduled mode this writes the until-next-
                            transition override (see toggleThemeNow). */}
                        <button
                          onClick={() => {
                            toggleTheme();
                          }}
                          className="w-full text-left px-4 py-2 text-sm text-secondary hover:bg-surface-muted flex items-center gap-3"
                        >
                          <i className={`fas ${theme === 'dark' ? 'fa-sun' : 'fa-moon'} w-4`}></i>
                          <span>{theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}</span>
                        </button>
                      </div>

                      <div className="border-t border-border-subtle py-1">
                        <button
                          onClick={() => {
                            handleSignOut();
                            setIsProfileDropdownOpen(false);
                          }}
                          className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-3"
                        >
                          <i className="fas fa-sign-out-alt w-4"></i>
                          <span>Sign Out</span>
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Mobile Menu Button */}
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="ea-icon-btn inline-flex items-center justify-center shrink-0 lg:hidden"
                aria-label="Toggle mobile menu"
                aria-expanded={isMobileMenuOpen}
              >
                <i className={`fas ${isMobileMenuOpen ? 'fa-times' : 'fa-bars'} text-xl`}></i>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Menu Overlay */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Mobile Menu Drawer */}
      <div
        className={`fixed top-0 right-0 h-full w-72 max-w-[85vw] bg-surface shadow-lg z-50 transform transition-transform duration-300 ease-in-out lg:hidden safe-top safe-bottom ${
          isMobileMenuOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="p-4 border-b border-border">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-primary">
                <span className="sr-only">Menu</span>
                <Image src="/logo.png" alt="" width={120} height={30} className="light-theme-only h-6 w-auto" />
                <Image src="/logo-dark.png" alt="" width={120} height={30} className="dark-theme-only h-6 w-auto" />
              </h2>
              <button
                onClick={() => setIsMobileMenuOpen(false)}
                className="ea-icon-btn inline-flex items-center justify-center text-muted hover:text-secondary"
                aria-label="Close menu"
              >
                <i className="fas fa-times text-xl"></i>
              </button>
            </div>
          </div>

          {/* Profile Section */}
          <div className="p-4 border-b border-border">
            <button
              onClick={() => {
                router.push('/athlete');
                setIsMobileMenuOpen(false);
              }}
              className="flex items-center gap-3 w-full hover:bg-surface-muted rounded-lg p-2 transition-colors"
            >
              <AvatarImage
                src={profile?.avatar_url}
                alt="Profile"
                size={48}
                fallbackInitials={getInitials(
                  formatDisplayName(profile?.first_name, null, profile?.last_name, profile?.full_name)
                )}
              />
              {/* min-w-0 + truncate: a long full_name must shorten, not push
                  the row past the 272px drawer (the classic min-width:auto
                  flex trap). */}
              <div className="flex-1 min-w-0 text-left">
                <p className="font-semibold text-primary truncate">
                  {formatDisplayName(profile?.first_name, null, profile?.last_name, profile?.full_name)}
                </p>
                <p className="text-sm text-muted">View Profile</p>
              </div>
            </button>
          </div>

          {/* Navigation Links.
              `min-h-0 overflow-y-auto` is load-bearing, not decoration: this list
              (7 nav links + Create Post + Edit Profile + Saved Posts + Settings +
              Sign Out) is ~840px tall. On a 667px-tall viewport — iPhone SE, the
              shortest phone we support — Saved Posts, Settings and **Sign Out**
              fell below the fold with nothing to scroll, so a signed-in user on
              that device could not sign out. `min-h-0` is required for a flex
              child to shrink below its content height and actually scroll. */}
          <nav className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2">
            {navLinks.map((link) => (
              <button
                key={link.path}
                onClick={() => {
                  router.push(link.path);
                  setIsMobileMenuOpen(false);
                }}
                className={`flex items-center gap-3 w-full px-4 py-3 text-left rounded-lg transition-colors ${
                  isActivePath(link.path)
                    ? link.accent === 'live'
                      ? 'bg-red-50 text-red-600'
                      : 'bg-brand-soft text-brand-fg'
                    : 'text-secondary hover:bg-surface-muted hover:text-brand-fg'
                }`}
              >
                <i className={`fas ${link.icon} w-5 text-center ${link.accent === 'live' ? 'text-red-600 animate-pulse text-[10px]' : ''}`}></i>
                <span className="font-medium">{link.label}</span>
              </button>
            ))}

            {/* Guardian-profiles, mirroring the desktop dropdown above. This
                block previously existed ONLY in that dropdown, so profile
                switching, the approval queue and Add an athlete were desktop-
                only — and after the nav moved to `lg`, tablets lost them too.
                The drawer has to be a superset of the dropdown, or raising the
                breakpoint silently removes features. */}
            {FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES && (
              <div className="pt-2 mt-2 border-t border-border">
                <p className="px-4 pb-1 text-[10px] font-semibold text-faint uppercase tracking-wide">
                  Your athletes
                </p>
                {managedProfiles.map(mp => (
                  <button
                    key={mp.id}
                    onClick={() => {
                      setActiveProfile(activeProfile?.id === mp.id ? null : mp);
                      setIsMobileMenuOpen(false);
                    }}
                    className="flex items-center gap-3 w-full px-4 py-3 text-left text-secondary hover:bg-surface-muted rounded-lg transition-colors"
                  >
                    <i className={`fas ${activeProfile?.id === mp.id ? 'fa-circle-check text-brand-fg' : 'fa-child-reaching'} w-5 text-center shrink-0`}></i>
                    <span className="font-medium flex-1 min-w-0 truncate">
                      {formatDisplayName(mp.first_name, null, mp.last_name, mp.full_name)}
                      {activeProfile?.id === mp.id && (
                        <span className="ml-1 text-xs text-brand-fg">(active)</span>
                      )}
                    </span>
                  </button>
                ))}
                {/* One door to the management surface — approvals and
                    transfers live inside the console now. Round J: parents
                    keep the door even with an empty roster. */}
                {(managedProfiles.length > 0 || profile?.user_type === 'parent') && (
                  <button
                    onClick={() => {
                      router.push('/app/guardian');
                      setIsMobileMenuOpen(false);
                    }}
                    className="flex items-center gap-3 w-full px-4 py-3 text-left text-brand-fg-strong hover:bg-brand-soft rounded-lg transition-colors"
                  >
                    <i className="fas fa-people-roof w-5 text-center"></i>
                    <span className="font-medium">Family console</span>
                  </button>
                )}
                <button
                  onClick={() => {
                    router.push('/app/guardian/add-athlete');
                    setIsMobileMenuOpen(false);
                  }}
                  className="flex items-center gap-3 w-full px-4 py-3 text-left text-brand-fg-strong hover:bg-brand-soft rounded-lg transition-colors"
                >
                  <i className="fas fa-plus w-5 text-center"></i>
                  <span className="font-medium">Add an athlete</span>
                </button>
              </div>
            )}

            {/* Managed orgs (phase 1) — the drawer must be a superset of the
                dropdown (the tablets-lost-features lesson above). */}
            {managedOrgs !== null && managedOrgs.length > 0 && (
              <div className="pt-2 mt-2 border-t border-border">
                <p className="px-4 pb-1 text-[10px] font-semibold text-faint uppercase tracking-wide">
                  Your organizations
                </p>
                {managedOrgs.map(org => (
                  <button
                    key={`${org.kind}:${org.id}`}
                    onClick={() => {
                      router.push(`/app/org/${org.kind}/${org.id}`);
                      setIsMobileMenuOpen(false);
                    }}
                    className="flex items-center gap-3 w-full px-4 py-3 text-left text-secondary hover:bg-surface-muted rounded-lg transition-colors"
                  >
                    <i className={`fas ${org.kind === 'league' ? 'fa-trophy' : 'fa-building'} w-5 text-center shrink-0`}></i>
                    <span className="font-medium flex-1 min-w-0 truncate">Manage {org.name}</span>
                  </button>
                ))}
              </div>
            )}

            <button
              onClick={handleCreatePost}
              className="flex items-center gap-3 w-full px-4 py-3 text-left text-secondary hover:bg-brand-soft hover:text-brand-fg rounded-lg transition-colors"
            >
              <i className="fas fa-plus w-5 text-center"></i>
              <span className="font-medium">Create Post</span>
            </button>

            <button
              onClick={() => {
                if (onEditProfile) {
                  onEditProfile();
                } else {
                  router.push('/athlete');
                }
                setIsMobileMenuOpen(false);
              }}
              className="flex items-center gap-3 w-full px-4 py-3 text-left text-secondary hover:bg-brand-soft hover:text-brand-fg rounded-lg transition-colors"
            >
              <i className="fas fa-edit w-5 text-center"></i>
              <span className="font-medium">Edit Profile</span>
            </button>

            <button
              onClick={() => {
                router.push('/athlete/saved');
                setIsMobileMenuOpen(false);
              }}
              className="flex items-center gap-3 w-full px-4 py-3 text-left text-secondary hover:bg-brand-soft hover:text-brand-fg rounded-lg transition-colors"
            >
              <i className="fas fa-bookmark w-5 text-center"></i>
              <span className="font-medium">Saved Posts</span>
            </button>

            <button
              onClick={() => {
                router.push('/settings');
                setIsMobileMenuOpen(false);
              }}
              className="flex items-center gap-3 w-full px-4 py-3 text-left text-secondary hover:bg-brand-soft hover:text-brand-fg rounded-lg transition-colors"
            >
              <i className="fas fa-cog w-5 text-center"></i>
              <span className="font-medium">Settings</span>
            </button>

            {/* The theme flip, mirroring the desktop dropdown. It shipped ONLY
                there at first, and that dropdown is `hidden lg:block` — so
                phones and iPad portrait had no way to switch themes short of
                hunting through Settings. Same trap the guardian block above
                documents: the drawer has to be a superset of the dropdown.

                Deliberately does NOT close the drawer (the desktop item does
                the same): the drawer itself re-themes under your finger, and
                that is the feedback. Closing would hide the result. */}
            <button
              onClick={() => {
                toggleTheme();
              }}
              className="flex items-center gap-3 w-full px-4 py-3 text-left text-secondary hover:bg-brand-soft hover:text-brand-fg rounded-lg transition-colors"
            >
              <i className={`fas ${theme === 'dark' ? 'fa-sun' : 'fa-moon'} w-5 text-center`}></i>
              <span className="font-medium">
                {theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              </span>
            </button>

            <div className="border-t border-border my-2"></div>

            <button
              onClick={() => {
                handleSignOut();
                setIsMobileMenuOpen(false);
              }}
              className="flex items-center gap-3 w-full px-4 py-3 text-left text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            >
              <i className="fas fa-sign-out-alt w-5 text-center"></i>
              <span className="font-medium">Sign Out</span>
            </button>
          </nav>

          {/* Footer */}
          <div className="p-4 border-t border-border">
            {/* min-h grows the ~16px text rows to real touch targets without
                changing the visual size of the links themselves. */}
            <div className="flex items-center justify-center gap-1 text-xs mb-2">
              <Link href="/terms" className="text-muted hover:text-secondary min-h-[44px] inline-flex items-center px-2">Terms</Link>
              <span className="text-gray-300">·</span>
              <Link href="/privacy" className="text-muted hover:text-secondary min-h-[44px] inline-flex items-center px-2">Privacy</Link>
              <span className="text-gray-300">·</span>
              <Link href="/contact" className="text-muted hover:text-secondary min-h-[44px] inline-flex items-center px-2">Contact</Link>
            </div>
            <p className="text-xs text-muted text-center">
              Edge Athlete &copy; {new Date().getFullYear()}
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
