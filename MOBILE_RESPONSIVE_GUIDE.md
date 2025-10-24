# Mobile Responsiveness Implementation Guide

## Overview
This guide provides a systematic approach to adding mobile responsiveness across the platform using Tailwind CSS breakpoints.

---

## Tailwind Breakpoints

```
sm:  640px   (small tablets portrait)
md:  768px   (tablets landscape, small laptops)
lg:  1024px  (laptops, small desktops)
xl:  1280px  (desktops)
2xl: 1536px  (large desktops)
```

**Strategy:** Mobile-first approach
- Base styles = mobile (< 640px)
- Add `md:` for tablet and up
- Add `lg:` for desktop and up

---

## Priority Components

### 1. Header Navigation
**File:** `src/components/Header.tsx`

**Changes Needed:**
```tsx
// Mobile: Hamburger menu
// Desktop: Full navigation bar

<header className="flex flex-col md:flex-row items-start md:items-center gap-4 md:gap-6">
  {/* Logo - always visible */}
  <div className="text-xl md:text-2xl">Edge Athlete</div>

  {/* Nav - hidden on mobile, shown on desktop */}
  <nav className="hidden md:flex gap-4">
    <Link href="/feed">Feed</Link>
    <Link href="/search">Search</Link>
  </nav>

  {/* Mobile menu button - shown on mobile only */}
  <button className="md:hidden">
    <HamburgerIcon />
  </button>
</header>
```

---

### 2. PostCard Component
**File:** `src/components/PostCard.tsx`

**Changes Needed:**
```tsx
// Adjust image sizes, font sizes, spacing

<div className="post-card">
  {/* Header */}
  <div className="flex gap-3 md:gap-4">
    <img
      src={avatar}
      className="w-10 h-10 md:w-12 md:h-12 rounded-full"
    />
    <div>
      <h3 className="text-sm md:text-base font-semibold">{name}</h3>
      <p className="text-xs md:text-sm text-gray-500">{timestamp}</p>
    </div>
  </div>

  {/* Caption */}
  <p className="text-sm md:text-base mt-3 md:mt-4">{caption}</p>

  {/* Media - full width on mobile */}
  <div className="w-full mt-3 md:mt-4">
    <img src={media} className="w-full h-auto" />
  </div>

  {/* Action buttons */}
  <div className="flex gap-4 md:gap-6 mt-3 md:mt-4">
    <button className="text-sm md:text-base">Like</button>
    <button className="text-sm md:text-base">Comment</button>
  </div>
</div>
```

---

### 3. Profile Pages
**File:** `src/app/athlete/[id]/page.tsx`

**Changes Needed:**
```tsx
// Stack sections vertically on mobile, grid on desktop

<div className="profile-page">
  {/* Profile Header */}
  <div className="flex flex-col md:flex-row gap-4 md:gap-6">
    <img
      src={avatar}
      className="w-24 h-24 md:w-32 md:h-32 rounded-full mx-auto md:mx-0"
    />
    <div className="text-center md:text-left">
      <h1 className="text-2xl md:text-3xl font-bold">{name}</h1>
      <p className="text-sm md:text-base">{bio}</p>
    </div>
  </div>

  {/* Stats Grid */}
  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mt-6">
    <StatCard />
    <StatCard />
    <StatCard />
    <StatCard />
  </div>

  {/* Media Tabs - full width on mobile */}
  <div className="mt-6">
    <ProfileMediaTabs />
  </div>
</div>
```

---

### 4. ProfileMediaTabs
**File:** `src/components/ProfileMediaTabs.tsx`

**Changes Needed:**
```tsx
// Horizontal tabs on desktop, vertical on mobile

<div className="media-tabs">
  {/* Tab Navigation */}
  <div className="flex flex-col md:flex-row gap-2 md:gap-4 border-b">
    <button className="tab py-2 md:py-3 px-4 text-sm md:text-base">
      All ({counts.all})
    </button>
    <button className="tab py-2 md:py-3 px-4 text-sm md:text-base">
      Stats ({counts.stats})
    </button>
    <button className="tab py-2 md:py-3 px-4 text-sm md:text-base">
      Tagged ({counts.tagged})
    </button>
  </div>

  {/* Filter Controls - stack on mobile */}
  <div className="flex flex-col md:flex-row gap-2 md:gap-4 mt-4">
    <select className="w-full md:w-auto">Sort</select>
    <select className="w-full md:w-auto">Filter</select>
  </div>

  {/* Media Grid */}
  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 md:gap-4 mt-4">
    {items.map(item => <MediaItem key={item.id} />)}
  </div>
</div>
```

---

### 5. Feed Layout
**File:** `src/app/feed/page.tsx`

**Changes Needed:**
```tsx
// Single column on mobile, sidebar on desktop

<div className="feed-layout">
  <div className="container mx-auto px-4">
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Main Feed - full width on mobile */}
      <div className="lg:col-span-2">
        <CreatePostButton className="w-full mb-4" />
        <PostFeed />
      </div>

      {/* Sidebar - hidden on mobile, shown on desktop */}
      <aside className="hidden lg:block">
        <SuggestedAthletes />
        <TrendingHashtags />
      </aside>
    </div>
  </div>
</div>
```

---

### 6. Forms & Modals
**File:** `src/components/CreatePostModal.tsx`, `src/components/GolfScorecardForm.tsx`

**Changes Needed:**
```tsx
// Full screen on mobile, centered modal on desktop

<div className="modal-overlay">
  <div className="modal-content
    fixed inset-0 md:relative
    w-full md:w-[600px]
    h-full md:h-auto
    md:rounded-lg
    overflow-y-auto">

    {/* Header */}
    <div className="sticky top-0 bg-white p-4 border-b">
      <h2 className="text-lg md:text-xl">Create Post</h2>
    </div>

    {/* Form Fields - full width on mobile */}
    <div className="p-4 space-y-4">
      <textarea
        className="w-full text-sm md:text-base"
        rows={4}
      />

      <button className="w-full md:w-auto px-6 py-2">
        Post
      </button>
    </div>
  </div>
</div>
```

---

### 7. Season Highlights Cards
**File:** `src/components/SeasonHighlights.tsx`

**Changes Needed:**
```tsx
// Stack cards vertically on mobile

<div className="season-highlights">
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
    {highlights.map(highlight => (
      <div key={highlight.id} className="season-card p-4 md:p-6">
        <h3 className="text-base md:text-lg font-bold">{highlight.sport}</h3>
        <p className="text-sm md:text-base">{highlight.season}</p>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-2 md:gap-3 mt-4">
          <div className="stat-tile">
            <span className="text-xs md:text-sm text-gray-500">Metric</span>
            <span className="text-lg md:text-xl font-bold">Value</span>
          </div>
        </div>
      </div>
    ))}
  </div>
</div>
```

---

### 8. Search Bar
**File:** `src/components/SearchBar.tsx`

**Changes Needed:**
```tsx
// Full width on mobile, constrained on desktop

<div className="search-container">
  <input
    type="search"
    className="w-full md:w-96
      px-4 py-2 md:py-3
      text-sm md:text-base
      rounded-full md:rounded-lg"
    placeholder="Search athletes, posts..."
  />

  {/* Results Dropdown - full width on mobile */}
  <div className="search-results
    absolute left-0 right-0 md:left-auto md:right-auto
    md:w-96
    max-h-96 overflow-y-auto">
    {results.map(result => (
      <div className="result-item p-3 md:p-4">...</div>
    ))}
  </div>
</div>
```

---

## Common Responsive Patterns

### Text Sizing
```tsx
// Mobile: 14px, Desktop: 16px
className="text-sm md:text-base"

// Mobile: 12px, Desktop: 14px
className="text-xs md:text-sm"

// Headings
className="text-xl md:text-2xl lg:text-3xl"
```

### Spacing
```tsx
// Gaps
className="gap-2 md:gap-4 lg:gap-6"

// Padding
className="p-3 md:p-4 lg:p-6"

// Margins
className="mt-4 md:mt-6 lg:mt-8"
```

### Layout
```tsx
// Stack on mobile, row on desktop
className="flex flex-col md:flex-row"

// Grid columns
className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3"

// Width constraints
className="w-full md:w-96 lg:w-[600px]"
```

### Visibility
```tsx
// Hide on mobile, show on desktop
className="hidden md:block"

// Show on mobile, hide on desktop
className="md:hidden"
```

---

## Testing Checklist

### Browser DevTools
1. Open Chrome DevTools (F12)
2. Click "Toggle Device Toolbar" (Ctrl+Shift+M)
3. Test these viewports:
   - iPhone SE (375px)
   - iPhone 12 Pro (390px)
   - iPad (768px)
   - iPad Pro (1024px)
   - Desktop (1440px)

### Real Devices
1. Test on actual iPhone/Android
2. Test on actual iPad/tablet
3. Check touch interactions
4. Verify font sizes are readable

### Critical User Flows
- [ ] Sign up / Login
- [ ] Create post
- [ ] View profile
- [ ] Browse feed
- [ ] Search athletes
- [ ] Add golf round
- [ ] View notifications
- [ ] Edit profile

---

## Implementation Order

1. **Start with layout components** (Header, Feed, Profile)
2. **Then cards** (PostCard, Season Highlights)
3. **Then forms** (Create Post, Golf Scorecard)
4. **Finally modals and overlays**

Test after each component to catch issues early.

---

## Quick Reference

```tsx
// Mobile-first pattern (RECOMMENDED)
<div className="
  text-sm md:text-base lg:text-lg
  p-4 md:p-6 lg:p-8
  flex flex-col md:flex-row
  gap-2 md:gap-4 lg:gap-6
">
  Content
</div>
```

---

## Next Steps

1. Create a branch: `feature/mobile-responsive`
2. Implement components in priority order
3. Test on multiple devices
4. Submit PR with screenshots from different viewports
5. Update this guide with lessons learned

---

**Author:** Claude Code
**Date:** October 2025
**Status:** Ready for implementation
