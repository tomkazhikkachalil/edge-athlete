# Quick Start: Enable Real-time Features

## ⚡ Fast Setup (5 minutes)

### Step 1: Enable Realtime in Supabase Dashboard

1. Open your Supabase project dashboard
2. Navigate to **Database** → **Replication**
3. Find the "Realtime" section
4. Ensure these tables are enabled:
   - ✅ `posts`
   - ✅ `notifications`

### Step 2: Run SQL Migration (2 Files)

**File 1: Core Realtime** (Required)

1. Open Supabase Dashboard → **SQL Editor**
2. Click "New Query"
3. Copy **entire contents** of `enable-realtime-core.sql`
4. Paste into SQL Editor
5. Click "Run" or press `Ctrl+Enter`

**Expected output:**
```
✅ Realtime features enabled successfully!
```

**File 2: Auto-Notifications** (Optional)

1. In SQL Editor, click "New Query" again
2. Copy **entire contents** of `enable-realtime-triggers.sql`
3. Paste and run
4. This adds auto-notifications for likes/comments/follows

**Expected output:**
```
✅ Notification triggers enabled!
```

### Step 3: Verify Setup

Run this query in SQL Editor:

```sql
-- Check if realtime is enabled
SELECT
  tablename,
  CASE
    WHEN tablename IN (
      SELECT tablename
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
    ) THEN 'Enabled ✅'
    ELSE 'Disabled ❌'
  END as realtime_status
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('posts', 'notifications');
```

**Expected result:**
```
tablename       | realtime_status
----------------|----------------
notifications   | Enabled ✅
posts           | Enabled ✅
```

### Step 4: Test Real-time in Browser

1. Start your dev server:
   ```bash
   npm run dev
   ```

2. Open http://localhost:3000/feed in **two browser windows**

3. In **Window 1**: Create a new post

4. In **Window 2**: Watch the post appear instantly (no refresh!)

5. Open browser console (F12) and look for:
   ```
   [REALTIME] Setting up posts subscription
   [REALTIME] Setting up post updates subscription
   [REALTIME] New post detected: {...}
   ```

---

## 🎯 What Gets Enabled

### Real-time Features:
- ✅ **New posts** appear instantly in all users' feeds
- ✅ **Like counts** update live when others like posts
- ✅ **Comment counts** update in real-time
- ✅ **Notifications** arrive with <100ms latency
- ✅ **Follow notifications** when someone follows you

### Advanced Search:
- ✅ **Sport filter** - Find athletes by sport
- ✅ **School filter** - Search by university
- ✅ **League filter** - Filter by conference/league
- ✅ **Date range** - Posts from specific time period
- ✅ **Type filter** - Athletes, Posts, or Clubs only

---

## 🚨 Troubleshooting

### Problem: "Realtime not working"

**Check 1:** Verify tables are in realtime publication
```sql
SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
```

**Check 2:** Verify replica identity is set
```sql
SELECT tablename, relreplident FROM pg_class
JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
WHERE relname IN ('posts', 'notifications');
```
Should show `relreplident = 'f'` (full)

**Check 3:** Look for WebSocket errors in browser console

---

### Problem: "Notifications table already exists"

If you get an error about notifications table existing:

```sql
-- Drop and recreate (only if needed)
DROP TABLE IF EXISTS notifications CASCADE;

-- Then run enable-realtime-features.sql again
```

---

### Problem: "Syntax error at line X"

**Cause:** You copied from a markdown file instead of the SQL file

**Solution:**
1. Open `enable-realtime-features.sql` (the actual SQL file)
2. Copy **all text** from that file
3. Paste into Supabase SQL Editor
4. Run

**Do NOT copy from:**
- ❌ IMPLEMENTATION_SUMMARY.md
- ❌ REALTIME_FEATURES.md
- ❌ README.md

**Do copy from:**
- ✅ enable-realtime-features.sql

---

## 📊 Performance Check

After enabling, monitor performance:

### Supabase Dashboard:
- **Realtime** → Check concurrent connections
- **Database** → Check query performance
- **API** → Monitor request counts

### Application:
- Browser console should show `[REALTIME]` logs
- No errors in Network tab (WebSocket should be connected)
- Posts/notifications appear instantly

---

## 🎉 Success Checklist

After setup, you should see:

- [x] Realtime enabled for `posts` and `notifications` tables
- [x] Notifications table created with RLS policies
- [x] Indexes created for performance
- [x] Triggers set up for auto-notifications
- [x] Browser console shows `[REALTIME]` logs
- [x] New posts appear instantly in feed
- [x] Like counts update live
- [x] Search filters work correctly

---

## 📖 Full Documentation

For complete details, see:

1. **`REALTIME_FEATURES.md`** - Technical implementation guide
2. **`IMPLEMENTATION_SUMMARY.md`** - Deployment checklist
3. **`enable-realtime-features.sql`** - Database setup script (run this!)

---

## ⚡ Quick Commands

```bash
# Start development server
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Check for errors
npm run lint
```

---

## 🆘 Need Help?

**Common issues:**

1. **WebSocket won't connect**
   - Check NEXT_PUBLIC_SUPABASE_URL is set
   - Check NEXT_PUBLIC_SUPABASE_ANON_KEY is set
   - Verify project is not paused in Supabase

2. **Notifications not appearing**
   - Check RLS policies allow reads for current user
   - Verify triggers are active (see Step 8-10 in SQL file)
   - Check browser console for errors

3. **Search filters not working**
   - Verify indexes exist on filtered columns
   - Check API endpoint is responding
   - Look for errors in Network tab

**Still stuck?** Check the full documentation in `REALTIME_FEATURES.md`

---

## 🚀 You're Ready!

Real-time features are now active. Open your app and experience:
- Instant feed updates
- Live notifications
- Advanced search with filters

Enjoy your real-time multi-sport athlete platform! 🎯
