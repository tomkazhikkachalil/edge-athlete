# CLAUDE.md

AI Assistant Guidelines for Student Projects Built on This Starter Template

## 🚀 Quick Start: Common Student Requests

### 1. "Delete the welcome page and update auth flow to redirect to /[page-name]"
```bash
# What to do:
1. Delete src/app/welcome folder
2. Update redirects in:
   - src/app/login/page.tsx (line 20 & 77)
   - src/app/page.tsx (line 42) 
   - src/app/admin/page.tsx (line 33)
   - src/app/auth/confirm/route.ts (line 33)
3. Update button text from "Welcome" to appropriate name
```

### 2. "Create a new protected page at /[page-name]"
- Copy the auth pattern from welcome/page.tsx
- Keep the useAuth() hook and redirect logic
- Add logout button (users need it!)
- Consider where to place admin panel link (if needed)

### 3. "Change the app name/branding"
- Update [Your App Name] placeholder in navigation
- Update NEXT_PUBLIC_APP_NAME in .env
- Update footer copyright text

### 4. "Customize colors/design"
- Current template uses black/white/gray design
- Students are FREE to change this!
- Tailwind CSS makes it easy to update colors

## Project Context

This is an educational AI starter template that students will build upon. When helping students:
- Maintain the existing folder/file structure
- Build new features on top of what exists
- Keep the authentication and security patterns intact
- Follow the established coding patterns
- Encourage the student to document their progress and commit to Github often

## 🔴 IMPORTANT: Documentation Best Practices

**As an AI assistant, you should ACTIVELY ENCOURAGE documentation throughout the development process:**

1. **After implementing features**, suggest students update `/CLAUDE.md` with new patterns or important notes
2. **For significant features**, guide them to create development logs:
   ```bash
   # Example prompt to student:
   "Great work on the chat feature! Let's document what you built:
   Create a new file: /docs/devlog/002-chat-feature.md"
   ```
3. **Encourage meaningful commits** after each working feature:
   ```bash
   git add .
   git commit -m "feat: add real-time chat with websockets"
   ```

**Why This Matters:**
- Helps students build a professional portfolio
- Reinforces learning through reflection
- Makes their code maintainable
- Helps future AI assistants understand their codebase

**Remember:** Suggest documentation AFTER implementation, not before. Let them build first, then reflect.

## When Students Ask for Help

1. **First**: Understand what they're trying to build
2. **Maintain**: The existing authentication and security patterns
3. **Extend**: Build on top of existing structures
4. **Guide**: Show them how to use existing utilities
5. **Explain**: Why certain patterns are important for security
6. **Encourage**: Documentation of their progress and learnings

Remember: This is a learning environment. Help students understand not just what to do, but why it matters for building secure, scalable applications.

## Development Logs

For detailed development logs and phase-by-phase changes, see `/docs/devlog/`.

## Architecture Overview

### Core Technologies
- **Framework**: Next.js 15 with App Router
- **Language**: TypeScript
- **Styling**: Tailwind CSS v4
- **Database**: PostgreSQL via Supabase
- **ORM**: Prisma
- **Authentication**: Supabase Auth (magic links)
- **AI**: OpenAI API (gpt-4.1-mini)
- **Email**: SendGrid for user communications
- **File Storage**: Supabase Storage

### Project Structure
```
src/
├── app/                    # Next.js App Router pages and API routes
│   ├── api/               # API endpoints
│   │   ├── admin/         # Admin-only endpoints
│   │   ├── ai/            # AI processing (text/image)
│   │   ├── auth/          # Authentication endpoints
│   │   └── upload/        # File upload endpoint
│   ├── admin/             # Admin panel
│   ├── auth/              # Auth flow pages
│   ├── welcome/           # Temporary welcome page (students will replace this)
│   ├── login/             # Login page
│   └── page.tsx           # Public homepage/marketing page
├── components/            # React components
│   └── admin/             # Admin-specific components
│       ├── AddUserForm.tsx # User creation form
│       └── UserTable.tsx   # User management table
├── lib/                   # Utilities and services
│   ├── auth.ts           # Auth utilities (server-side)
│   ├── email-service.ts  # SendGrid integration
│   ├── prisma.ts         # Database client
│   ├── rate-limit.ts     # Rate limiting utility
│   ├── supabase.ts       # Supabase clients
│   └── useAuth.tsx       # Auth React hook (client-side)
└── types/                 # TypeScript definitions
```

## 🛑 DO NOT MODIFY - CRITICAL FILES

**⚠️ WARNING: Modifying these files will break core functionality! ⚠️**

These files contain critical configurations that ensure the app works correctly:

**Authentication & Security:**
1. `/src/lib/supabase.ts` - SSR cookie handling for auth
2. `/src/lib/rate-limit.ts` - Production-ready rate limiting
3. `/src/app/api/auth/login/route.ts` - Rate limiting implementation
4. `/scripts/setup-database.mjs` - RLS policies and database setup

**AI Configuration:**
5. `/src/app/api/ai/text/route.ts` - Uses special responses.create() API
6. `/src/app/api/ai/image/route.ts` - Configured for gpt-4.1-mini model

**Core Infrastructure:**
7. `/src/app/layout.tsx` - Root layout with AuthProvider
8. `/.env.example` - Template for required environment variables
9. `/prisma/schema.prisma` - Core database models (User, File)

Modifying these files may break authentication, security, or core functionality.

## Out-of-the-Box Services

### 1. Authentication (Supabase Auth)
- **Magic Link Only**: No passwords, users sign in via email
- **Whitelist Approach**: Admin must create users first
- **Rate Limited**: 5 login attempts per IP per 15 minutes
- **How it works**:
  1. Admin creates user in admin panel
  2. User receives welcome email via SendGrid
  3. User requests magic link on login page
  4. Supabase sends magic link email
  5. User clicks link and is authenticated
- **Security**: 
  - RLS ensures users only see their own data
  - Rate limiting prevents email bombing
  - Session auto-refresh keeps users logged in

### 2. Email Communications (SendGrid)
- **Purpose**: User notifications, welcome emails, custom alerts
- **NOT for**: Authentication emails (handled by Supabase)
- **Configuration**: Uses SENDGRID_API_KEY or SMTP settings
- **Templates**: Welcome email and notification templates included
- **Usage**: 
  ```typescript
  import { sendWelcomeEmail, sendNotificationEmail } from '@/lib/email-service';
  ```

### 3. AI Processing (OpenAI)
- **IMPORTANT**: Uses gpt-4.1-mini model (do NOT change to gpt-4o-mini)
- **Text API** (`/api/ai/text`):
  - Uses new `openai.responses.create()` method
  - NOT the older chat completions API
- **Image API** (`/api/ai/image`):
  - Analyzes uploaded images
  - Uses vision capabilities
- **Both require**: User authentication

### 4. Database (Supabase PostgreSQL + Prisma)
- **Models**: User and File (extendable)
- **RLS Enabled**: Users can only access their own data
- **Admin Override**: Service role key for admin operations
- **Commands**:
  ```bash
  npm run db:migrate    # Run migrations
  npm run db:seed       # Seed database (custom command)
  npm run db:generate   # Generate Prisma client
  npm run studio        # Open Prisma Studio
  npm run setup         # First-time database setup
  npm run lint          # Check code quality
  npm run build         # Build for production
  ```

### 5. File Storage (Supabase Storage)
- **Bucket**: "uploads" (public read access)
- **Limits**: 5MB max, images only
- **Organization**: Files stored by user ID
- **Access**: Through signed URLs

## Authentication Flow

1. **User Creation** (Admin only):
   - Admin adds user via `/admin` panel
   - User record created in database
   - Supabase Auth user created if needed
   - Welcome email sent via SendGrid

2. **User Login**:
   - User enters email on `/login`
   - System checks if user exists in database
   - Supabase sends magic link
   - User clicks link → redirected to `/welcome` (students will change this)

3. **Session Management**:
   - Tokens stored in cookies via Supabase SSR
   - `useAuth()` hook provides user state
   - Protected routes check authentication
   - Sessions auto-refresh every 5 minutes

## Common Modifications Students Make

### Removing Welcome Page & Changing Auth Redirect
When students want to redirect to their custom page instead of `/welcome`:
1. Delete the `/src/app/welcome` folder
2. Update all redirect references (see Quick Start section)
3. Ensure the new destination page has auth protection

### Moving Admin Panel Link
The admin panel button is currently in the navigation. Students often move it to:
- `/profile` or `/account` page
- Settings dropdown menu
- Side navigation drawer
Remember: Only show it when `user.role === 'admin'`

### Keeping Logout Accessible
The logout button should ALWAYS be easily accessible:
- Keep it in the top navigation (typical location)
- Can be in a dropdown menu, but make it obvious
- Use the `logout` function from `useAuth()` hook

### Customizing Design & Branding
- The template uses a clean black/white/gray design
- Students should feel free to customize ALL styling
- Common changes:
  - Brand colors in buttons and links
  - Font families
  - Spacing and layout
  - Dark mode preferences
  - Component styles

### After Making Changes
ALWAYS remind students to:
1. Run `npm run lint` to check for errors
2. Run `npm run build` to ensure production build works
3. Test the auth flow (login → redirect → logout)
4. Commit their changes with descriptive messages

## Critical Pattern: Duplicate Email Prevention

### Understanding RLS and Admin Operations
When working with Supabase and Row Level Security (RLS), admin operations require special handling:

**The Problem**: RLS policies can prevent API routes from checking existing user data
**The Solution**: Use service role client for admin operations

```typescript
// src/lib/supabase.ts
export const supabaseAdmin = supabaseServiceRoleKey 
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    })
  : null;
```

### Implementing Robust Duplicate Checking
For user registration, always implement multi-layer duplicate prevention:

```typescript
// 1. Pre-flight check with admin client (bypasses RLS)
if (supabaseAdmin) {
  const { data: existingProfiles } = await supabaseAdmin
    .from('profiles')
    .select('email')
    .eq('email', email.toLowerCase());
    
  if (existingProfiles && existingProfiles.length > 0) {
    return NextResponse.json(
      { error: 'This email is already registered. Please log in instead.' },
      { status: 409 }
    );
  }
}

// 2. Also check auth.users directly
const { data: authUsers } = await supabaseAdmin.auth.admin.listUsers();
const existingAuthUser = authUsers.users.find(user => 
  user.email?.toLowerCase() === email.toLowerCase()
);

// 3. Proceed with Supabase Auth (has built-in duplicate prevention)
const { data, error } = await supabase.auth.signUp({ email, password });
```

### Environment Variable Requirements
Always ensure these are set in production:
```bash
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
```

## Adding New Features

### Creating New API Routes
```typescript
// src/app/api/your-feature/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function POST(request: NextRequest) {
  try {
    // Require authentication
    const user = await requireAuth(request);
    
    // Your logic here
    
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
```

### Adding Database Models
1. Edit `prisma/schema.prisma`
2. Add your model with proper relations
3. Run `npm run db:migrate`
4. Update seed file if needed

### Creating Protected Pages
```typescript
// src/app/your-page/page.tsx
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/useAuth';

export default function YourPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  if (loading || !user) return null;

  return (
    <div className="min-h-screen">
      {/* Add your navigation here */}
      
      {/* Your page content */}
      <div className="container mx-auto p-6">
        <h1>Your protected content here</h1>
        
        {/* Don't forget the logout button! */}
        <button onClick={logout}>Logout</button>
      </div>
    </div>
  );
}
```

## Environment Variables

Required for deployment (all from .env.example):
```bash
# OpenAI API key (required for AI features)
OPENAI_API_KEY=your_openai_api_key_here

# Supabase Configuration (required for database and storage)
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url_here
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key_here

# Database URLs for Prisma
# DATABASE_URL uses transaction pooler (port 6543) for better app performance
DATABASE_URL=postgres://postgres.your_project_ref:your_password@aws-0-your-region.pooler.supabase.com:6543/postgres?schema=public&pgbouncer=true&sslmode=require
# DIRECT_DATABASE_URL uses session pooler (port 5432) for migrations and schema changes
DIRECT_DATABASE_URL=postgres://postgres.your_project_ref:your_password@aws-0-your-region.pooler.supabase.com:5432/postgres?sslmode=require

# Email Configuration (for SendGrid)
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=your_sendgrid_api_key_here
EMAIL_FROM=noreply@yourdomain.com

# App Configuration
NEXT_PUBLIC_APP_NAME="My App"
ADMIN_EMAIL=admin@yourdomain.com
```

## Security Best Practices

1. **Authentication Required**: All API routes except `/api/auth/*` require authentication
2. **RLS Enforcement**: Database queries respect Row Level Security
3. **User Isolation**: Users can only access their own data
4. **Admin Separation**: Admin features require role check
5. **File Security**: Uploads organized by user ID
6. **Input Validation**: Always validate user input
7. **Error Handling**: Don't expose internal errors
8. **Rate Limiting**: Login endpoint protected against abuse (5 attempts/15 min)
9. **Session Refresh**: Automatic token refresh prevents unexpected logouts

## Common Patterns

### Sending User Notifications
```typescript
import { sendNotificationEmail } from '@/lib/email-service';

// In your API route or server action
await sendNotificationEmail(
  user.email,
  'Important Update',
  'Your process has completed successfully!',
  user.name
);
```

### Protecting Admin Routes
```typescript
import { requireAdmin } from '@/lib/auth';

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  // Admin-only logic
}
```

### Using AI Features
```typescript
// Text processing
const response = await fetch('/api/ai/text', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ text: 'Process this text' })
});

// Image analysis
const response = await fetch('/api/ai/image', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ fileId: uploadedFile.id })
});
```

## UI Patterns

- **Current Design**: Clean black/white/gray theme (students can change this!)
- **Layout**: Consistent navigation + content structure
- **Styling**: Tailwind CSS for easy customization
- **Input Fields**: Global black text styling applied via CSS for better readability
- **Components**: Place new components in `/src/components`, organize by feature
- **State**: Use React hooks and context when needed
- **Responsive**: Mobile-first approach recommended

## Spacing & Design System

### Vertical Rhythm System (12/24/48px)

The application uses a systematic spacing approach based on CSS custom properties:

```css
/* Spacing Tokens */
--space-micro: 12px;   /* ½ base - micro spacing, icons, small gaps */
--space-base: 24px;    /* 1x base - standard gaps, card padding */
--space-section: 48px; /* 2x base - major sections, page regions */
```

### Usage Guidelines

**Use --space-micro (12px) for:**
- Icon margins and small gaps (`gap-micro`)
- Input field padding (`px-micro`, `py-micro`)
- Chip/badge spacing
- Button internal padding

**Use --space-base (24px) for:**
- Card content padding (`p-base`)
- Standard gaps between elements (`gap-base`)
- Form field spacing (`space-base`)
- Navigation spacing

**Use --space-section (48px) for:**
- Major section breaks (`py-section`)
- Page region separation
- Large whitespace areas
- Between distinct content blocks

### Available Utility Classes

```css
/* Spacing (margin-bottom) */
.space-micro, .space-base, .space-section

/* Gaps (flexbox/grid) */
.gap-micro, .gap-base, .gap-section

/* Padding */
.p-micro, .px-micro, .py-micro, .pt-micro, .pb-micro, .pl-micro, .pr-micro
.p-base, .px-base, .py-base, .pt-base, .pb-base, .pl-base, .pr-base
.p-section, .px-section, .py-section, .pt-section, .pb-section, .pl-section, .pr-section

/* Margins */
.m-micro, .mx-micro, .my-micro, .mt-micro, .mb-micro
.m-base, .mx-base, .my-base, .mt-base, .mb-base
.m-section, .mx-section, .my-section, .mt-section, .mb-section
```

### Card System

Season Highlights cards use a fixed-height system for consistency:

```css
.season-card {
  min-height: 280px;        /* Fixed total height */
  display: flex;
  flex-direction: column;
}
```

- Header: 80px fixed (icon + title + chips)
- Stats area: flexible (`flex: 1`)
- Footer: 32px fixed
- All internal padding uses `var(--space-micro)` (12px)
- Text truncation handles long content gracefully

## Weight System Implementation

### Pattern: Direct Save/Display (No Conversions)
When building weight/measurement systems, use this pattern:

```typescript
// Database fields
weight_display: number    // The exact value user entered
weight_unit: string      // User's preferred unit ('lbs', 'kg', 'stone')

// Save exactly what user enters
const weightDisplay = parseFloat(userInput);
updateData = {
  weight_display: weightDisplay,
  weight_unit: selectedUnit
};

// Display exactly what was saved
const displayValue = `${profile.weight_display} ${profile.weight_unit}`;
```

**Why this approach:**
- Preserves user intent and expectations
- Eliminates conversion errors and precision loss
- Simpler to maintain and debug
- Better user experience

## Create Post Modal Pattern (Single Column UX)

### Design Principles
The Create Post modal uses an optimized single-column vertical flow for excellent UX:

```typescript
// Vertical Structure - Single Scroll Path
1. Sport Selection (dropdown at top)
2. Golf Scorecard (embedded in flow when selected)
3. Media Upload (compact button → large preview)
4. Caption & Hashtags (natural flow underneath)
5. Visibility Settings (clean options at bottom)
6. Preview System (separate modal for post preview)
```

### Modal Structure & Scrolling
```typescript
// Proper scrolling implementation
<div className="max-w-6xl w-full max-h-[95vh] flex flex-col">
  <header className="p-6">Header Content</header>
  <div className="flex-1 overflow-y-auto">  // Scrollable container
    <div className="p-6">  // No height constraint
      {/* All content flows vertically */}
    </div>
  </div>
  <footer className="p-6">Footer Actions</footer>
</div>
```

### Media Upload Pattern
```typescript
// Compact upload button + large preview display
<div className="mb-6">
  {/* Small upload button */}
  <button className="flex items-center gap-2 px-3 py-2 text-sm border-2 border-dashed">
    <i className="fas fa-plus text-sm" />
    Add Media
  </button>

  {/* Large primary media display */}
  {mediaFiles.length > 0 && (
    <div className="space-y-2">
      <div className="relative rounded-lg overflow-hidden">
        <div className="aspect-[4/3] relative">
          <LazyImage className="w-full h-full object-cover" />
          <div className="absolute top-2 left-2 bg-black/60 text-white text-xs px-2 py-1 rounded">
            Primary
          </div>
        </div>
      </div>

      {/* Secondary thumbnails grid */}
      {mediaFiles.length > 1 && (
        <div className="grid grid-cols-4 gap-2">
          {/* Smaller thumbnails with drag reorder */}
        </div>
      )}
    </div>
  )}
</div>
```

### Preview Modal System
```typescript
// Separate preview modal for post confidence
{showPreview && (
  <div className="fixed inset-0 bg-black bg-opacity-75 z-[60]">
    <div className="max-w-2xl w-full max-h-[90vh] overflow-y-auto">
      {/* Realistic post preview */}
      <div className="bg-white border border-gray-200 rounded-lg">
        {/* Mock user header */}
        <div className="p-4 border-b">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full" />
            <div>
              <div className="font-semibold">Your Name</div>
              <div className="text-sm text-gray-500">
                Just now • {visibility === 'public' ? 'Public' : 'Private'}
              </div>
            </div>
          </div>
        </div>

        {/* Post content with media, caption, sport badges */}
        <div className="p-4">
          {caption && <p className="whitespace-pre-wrap">{caption}</p>}
          {/* Media display logic */}
          {/* Golf scorecard summary */}
          {/* Sport category badge */}
        </div>

        {/* Mock engagement */}
        <div className="px-4 py-3 border-t flex gap-4 text-gray-500">
          <button>Like</button>
          <button>Comment</button>
          <button>Share</button>
        </div>
      </div>

      {/* Preview actions */}
      <div className="flex justify-between p-4">
        <button onClick={() => setShowPreview(false)}>Edit Post</button>
        <button onClick={handleSubmit}>Post Now</button>
      </div>
    </div>
  </div>
)}
```

### Golf Scorecard Integration
```typescript
// Embedded in vertical flow, not side panel
{selectedType === 'golf' && (
  <div className="mb-6">
    <h3 className="text-sm font-semibold text-gray-700 mb-3">Golf Scorecard</h3>
    <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
      <GolfScorecardForm
        onDataChange={setGolfRoundData}
        initialData={golfRoundData}
      />
    </div>
  </div>
)}
```

### User Experience Flow
```typescript
// Optimized single-path user journey
1. Select Sport → Dropdown at top
2. Fill Golf Scorecard → Appears inline when golf selected
3. Add Media → Compact button → Beautiful large preview
4. Write Caption → With hashtag suggestions underneath
5. Set Visibility → Clear privacy options
6. Preview Post → See exactly what will be posted
7. Submit → With confidence and validation
```

### Key UX Improvements
- **Single Column Flow**: No confusing left/right panels
- **Proper Scrolling**: Fixed modal height/overflow issues
- **Large Media Preview**: Users see exactly what they're uploading
- **Compact Upload**: Small button doesn't dominate the interface
- **Preview System**: Confidence-building before posting
- **Golf Integration**: Scorecard flows naturally in sequence
- **Mobile Optimized**: Single column works perfectly on all screens

### Modal Size & Spacing
```css
/* Generous modal sizing for less cramped feel */
.modal-container {
  max-width: 1536px; /* max-w-6xl */
  max-height: 95vh;
  padding: 1.5rem;   /* p-6 throughout */
}

/* Media display spacing optimization */
.media-container {
  space-y: 0.5rem;   /* Tight spacing around media */
  /* No excess background/shadows */
}
```

### Validation Pattern
```typescript
const isValidForSubmission = () => {
  if (selectedType === 'general') {
    return mediaFiles.length > 0; // Media required
  } else if (selectedType === 'golf') {
    return golfData.courseName && golfData.score; // Golf data required
  }
  return false;
};
```

## Athlete Profile Design Patterns

### Professional Profile Layout Structure
When implementing athlete profiles, use this polished design pattern established in `/src/app/athlete/page.tsx`:

```tsx
// Clean navigation header separated from profile content
<header className="bg-white border-b border-gray-200 px-6 py-4">
  <div className="max-w-7xl mx-auto flex items-center justify-between">
    <h1 className="text-2xl font-bold text-gray-900">Athletic Profile</h1>
    {/* Action buttons: Create Post, Feed, Edit Profile, Logout */}
  </div>
</header>

// Professional profile card with sectioned layout
<div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
  {/* Main profile section */}
  <div className="p-8">
    {/* Large avatar (192px) with rating bubble and upload button */}
    {/* Name, badges, sport info, bio, stats */}
  </div>
  
  {/* Vitals section with gray background */}
  <div className="border-t border-gray-200 bg-gray-50 px-8 py-6">
    {/* Individual white cards for each vital */}
  </div>
  
  {/* Social media bar */}
  <div className="border-t border-gray-200 px-8 py-4">
    {/* Centered social media links */}
  </div>
</div>
```

### Vitals Grid Pattern
Use individual white cards for each vital statistic:

```tsx
<div className="grid grid-cols-2 md:grid-cols-5 gap-6">
  <div className="text-center bg-white rounded-lg border border-gray-200 p-4">
    <div className="text-2xl font-bold text-gray-900 mb-1">
      {/* Large value */}
    </div>
    <div className="text-sm font-medium text-gray-500 uppercase tracking-wide">
      {/* Small label */}
    </div>
  </div>
</div>
```

### Content Layout Strategy
Use a three-column grid for main content:

```tsx
<div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
  {/* Left side: Sport highlights and activity (2 columns) */}
  <div className="lg:col-span-2">
    <MultiSportHighlights />
    <MultiSportActivity />
  </div>
  
  {/* Right side: Recent posts sidebar (1 column) */}
  <div className="lg:col-span-1">
    <RecentPosts />
  </div>
</div>
```

### Key Design Principles
1. **Visual Hierarchy**: Navigation → Profile → Vitals → Social → Content
2. **Consistent Spacing**: Use design system tokens for spacing
3. **Professional Colors**: White cards on gray backgrounds for depth
4. **Responsive Design**: Grid layouts that adapt to mobile
5. **Sectioned Cards**: Use borders and backgrounds to create clear sections

### Common Pitfalls to Avoid
- **Duplicate React Keys**: Always filter duplicate sport keys in dropdowns
- **Inline Editing Conflicts**: Ensure proper state management for inline fields
- **Avatar Upload UX**: Provide clear loading states and error handling
- **Social Media Display**: Handle empty states gracefully with placeholders

## Deployment Considerations

1. **Database**: Ensure Supabase project is set up with proper pooling
2. **Environment**: All environment variables must be set
3. **Seeds**: Run `npm run setup` on first deployment
4. **Storage**: Configure Supabase storage bucket policies
5. **Email**: Verify SendGrid sender domain