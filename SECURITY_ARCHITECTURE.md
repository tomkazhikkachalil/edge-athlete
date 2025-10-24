# Security Architecture & RLS Policies

## Overview
This document outlines the comprehensive security architecture for the athlete profile system, including Row Level Security (RLS) policies, storage policies, and authentication patterns.

## Core Security Principles
1. **Zero-trust model**: All tables have RLS enabled by default
2. **Owner-only access**: Users can only access their own data (private profiles)
3. **Authenticated-only**: No public access to user data
4. **Storage isolation**: File uploads organized by user ID

## Database Tables & RLS Policies

### 1. Profiles Table
**Purpose**: Core user profile data  
**RLS Status**: ✅ Enabled

| Policy | Operation | Rule |
|--------|-----------|------|
| View own profile | SELECT | `auth.uid() = id` |
| Insert own profile | INSERT | `auth.uid() = id` |
| Update own profile | UPDATE | `auth.uid() = id` |
| Delete own profile | DELETE | ❌ Not allowed (cascade from auth.users) |

**Key Points**:
- No public read access (private profiles)
- Automatic profile creation on signup via trigger
- Profile deletion only through auth.users cascade

### 2. Athlete Badges Table
**Purpose**: Achievement/certification badges  
**RLS Status**: ✅ Enabled

| Policy | Operation | Rule |
|--------|-----------|------|
| View own badges | SELECT | `profile_id = auth.uid()` |
| Insert own badges | INSERT | `profile_id = auth.uid()` |
| Update own badges | UPDATE | `profile_id = auth.uid()` |
| Delete own badges | DELETE | `profile_id = auth.uid()` |

### 3. Season Highlights Table
**Purpose**: Athletic performance highlights per season  
**RLS Status**: ✅ Enabled

| Policy | Operation | Rule |
|--------|-----------|------|
| View own highlights | SELECT | `profile_id = auth.uid()` |
| Manage own highlights | ALL | `profile_id = auth.uid()` |

### 4. Performances Table
**Purpose**: Individual performance records  
**RLS Status**: ✅ Enabled

| Policy | Operation | Rule |
|--------|-----------|------|
| View own performances | SELECT | `profile_id = auth.uid()` |
| Manage own performances | ALL | `profile_id = auth.uid()` |

### 5. Sports Table
**Purpose**: Sports associations for athletes  
**RLS Status**: ✅ Enabled

| Policy | Operation | Rule |
|--------|-----------|------|
| View own sports | SELECT | `profile_id = auth.uid()` |
| Manage own sports | ALL | `profile_id = auth.uid()` |

### 6. Clubs & Athlete_Clubs Tables
**Purpose**: Club associations  
**RLS Status**: ✅ Enabled

| Table | Policy | Operation | Rule |
|-------|--------|-----------|------|
| clubs | View clubs | SELECT | Authenticated users only |
| athlete_clubs | View own associations | SELECT | `athlete_id = auth.uid()` |
| athlete_clubs | Manage own associations | ALL | `athlete_id = auth.uid()` |

## Storage Bucket Policies

### 1. Avatars Bucket
**Public**: ✅ Yes (read-only)  
**Path Structure**: `/avatars/{user_id}/filename`

| Policy | Operation | Rule |
|--------|-----------|------|
| Public read | SELECT | All allowed |
| User upload | INSERT | Authenticated users |
| User update | UPDATE | Authenticated users |
| User delete | DELETE | Authenticated users |

**Security Notes**:
- Public read allows avatar display without auth
- Write operations require authentication
- Consider adding path-based restrictions for production

### 2. Uploads Bucket
**Public**: ✅ Yes (read-only)  
**Path Structure**: `/uploads/{user_id}/filename`

| Policy | Operation | Rule |
|--------|-----------|------|
| Public read | SELECT | All allowed |
| User upload | INSERT | Authenticated users |

### 3. Badges Bucket (Optional)
**Public**: ✅ Yes (read-only)  
**Purpose**: System-wide badge icons

| Policy | Operation | Rule |
|--------|-----------|------|
| Public read | SELECT | All allowed |
| Admin upload | INSERT | Admin role only (commented out) |

## Authentication Flow

### User Registration
1. User signs up via Supabase Auth
2. `handle_new_user()` trigger creates profile automatically
3. Profile inherits user ID from auth.users
4. RLS policies immediately apply

### Session Management
- JWT tokens stored in httpOnly cookies
- Auto-refresh every 5 minutes
- Service role key for admin operations only

## API Security

### Protected Routes
All API routes except `/api/auth/*` require authentication via:
```typescript
const user = await requireAuth(request);
```

### Admin Operations
Admin operations use service role client to bypass RLS:
```typescript
const supabaseAdmin = createClient(url, serviceRoleKey);
```

## Security Best Practices

### ✅ Currently Implemented
1. **RLS on all tables**: Every table has row-level security enabled
2. **Owner-only access**: Users can only CRUD their own data
3. **Authenticated-only**: No anonymous data access
4. **Cascade deletes**: Profile deletion cascades properly
5. **Updated_at triggers**: Automatic timestamp updates
6. **Indexed foreign keys**: Performance optimization with security

### ⚠️ Considerations for Production

1. **Storage Path Enforcement**:
```sql
-- Stronger path validation for avatars
CREATE POLICY "Users upload to own folder" 
  ON storage.objects FOR INSERT 
  WITH CHECK (
    bucket_id = 'avatars' AND 
    auth.uid()::text = (storage.foldername(name))[1]
  );
```

2. **Rate Limiting**:
- Implement API rate limiting (already done for login)
- Add storage upload limits

3. **Public Profile Option**:
```sql
-- Future: Add public profile flag
ALTER TABLE profiles ADD COLUMN is_public BOOLEAN DEFAULT false;

-- Policy for public profiles
CREATE POLICY "Public profiles viewable by all" 
  ON profiles FOR SELECT 
  USING (is_public = true OR auth.uid() = id);
```

4. **Audit Logging**:
```sql
-- Consider adding audit table for sensitive operations
CREATE TABLE audit_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  action TEXT,
  table_name TEXT,
  record_id UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

## Migration Path to Public Profiles

When ready to enable public profiles:

1. **Add visibility column**:
```sql
ALTER TABLE profiles ADD COLUMN visibility TEXT 
  DEFAULT 'private' 
  CHECK (visibility IN ('private', 'public', 'friends'));
```

2. **Update RLS policies**:
```sql
DROP POLICY "Users can view their own profile" ON profiles;

CREATE POLICY "View profiles based on visibility" 
  ON profiles FOR SELECT 
  USING (
    auth.uid() = id OR 
    visibility = 'public' OR
    (visibility = 'friends' AND /* friend check logic */)
  );
```

3. **Add profile slug for public URLs**:
```sql
ALTER TABLE profiles ADD COLUMN slug TEXT UNIQUE;
CREATE INDEX idx_profiles_slug ON profiles(slug) WHERE visibility = 'public';
```

## Security Checklist

- [x] RLS enabled on all tables
- [x] Owner-only CRUD operations
- [x] No public data access (private by default)
- [x] Storage buckets configured
- [x] Authentication required for APIs
- [x] Service role key protected
- [x] Cascade deletes configured
- [x] Indexes on foreign keys
- [ ] Rate limiting on all endpoints
- [ ] File size limits enforced
- [ ] Input validation on all forms
- [ ] SQL injection prevention
- [ ] XSS protection

## Testing Security

### Manual Tests
1. Try accessing another user's profile data
2. Attempt unauthorized file uploads
3. Test cascade deletes
4. Verify JWT expiration handling

### SQL Test Queries
```sql
-- Test RLS is working (should return empty if not your data)
SELECT * FROM profiles WHERE id != auth.uid();

-- Verify policies exist
SELECT schemaname, tablename, policyname 
FROM pg_policies 
WHERE schemaname = 'public';

-- Check RLS status
SELECT schemaname, tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public';
```

## Emergency Procedures

### Disable User Access
```sql
-- Revoke user access without deleting data
UPDATE auth.users SET banned_until = '2099-12-31' WHERE id = 'user-id';
```

### Force Logout All Users
```sql
-- Invalidate all sessions (in Supabase dashboard)
-- Settings > Auth > Advanced > Rotate JWT Secret
```

### Emergency RLS Override (Admin Only)
```sql
-- Use service role key in application
-- Never expose service role key to client
```

## Contact & Support
- Security issues: Report immediately to admin
- RLS questions: Check Supabase documentation
- Policy updates: Require database migration