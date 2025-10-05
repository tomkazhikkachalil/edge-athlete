# Followers/Following Debugging Guide

## 🔍 Issue: Followers/Following Not Showing

The database has the data, queries work correctly, but the UI shows empty. Here's how to debug:

## 📊 Confirmed Working:
- ✅ Database has 1 follow: John → Tom (accepted)
- ✅ SQL queries return correct data
- ✅ API logic is correct
- ✅ React components have been fixed with proper keys

## 🧪 Debug Steps

### Step 1: Check Which User You're Logged In As

Visit the debug page I created:
```
http://localhost:3003/debug-followers
```

This page shows:
- Your current user ID and email
- Buttons to test each API endpoint
- Real-time API responses
- Expected results for each user

### Step 2: Verify API Responses

On the debug page, click:
1. **"Test Followers"** - Should show who follows you
2. **"Test Following"** - Should show who you follow
3. **"Test Requests"** - Should show pending requests

Compare the API response with expected results.

### Step 3: Check Browser Console

1. Open browser DevTools (F12)
2. Go to Console tab
3. Look for these logs:
   ```
   [FOLLOWERS PAGE] Data received: { type: 'followers', count: X, rawData: {...} }
   [FOLLOWERS PAGE] Setting followers: [...]
   ```

### Step 4: Check Network Tab

1. Open browser DevTools (F12)
2. Go to Network tab
3. Navigate to `/app/followers`
4. Look for request to `/api/followers?type=followers`
5. Check:
   - Status code (should be 200)
   - Response body (should have data)
   - Request cookies (should have auth token)

## 🎯 Expected Results by User

### For Tom (ID: 491d40c8-8452-4f0a-b80c-eace800fd13b)

**Followers Tab:**
```json
{
  "followers": [
    {
      "id": "3ffb399d-40b0-47fe-a8c3-5dde9f7a6ec2",
      "follower": {
        "id": "8ea6e939-1972-45ec-a5ca-6d6f97cc212c",
        "first_name": "John",
        "middle_name": "Tom",
        "last_name": "Doe",
        "full_name": "johndoe",
        "sport": "golf"
      }
    }
  ]
}
```

Should display: **John Tom Doe** (golf)

**Following Tab:** Empty array `[]`

### For John (ID: 8ea6e939-1972-45ec-a5ca-6d6f97cc212c)

**Followers Tab:** Empty array `[]`

**Following Tab:**
```json
{
  "following": [
    {
      "id": "3ffb399d-40b0-47fe-a8c3-5dde9f7a6ec2",
      "following": {
        "id": "491d40c8-8452-4f0a-b80c-eace800fd13b",
        "first_name": "Tom",
        "middle_name": null,
        "last_name": "Kazhikkachalil",
        "full_name": "Tom Kazhikkachalil",
        "sport": null
      }
    }
  ]
}
```

Should display: **Tom Kazhikkachalil**

## 🔧 Common Issues & Fixes

### Issue 1: Not Logged In
**Symptom:** API returns 401 Unauthorized
**Fix:** Login at `/` or `/login`

### Issue 2: Wrong User Logged In
**Symptom:** Empty results but API status is 200
**Fix:**
- Check debug page to see which user you are
- Logout and login as the correct user

### Issue 3: Cookies Not Sent
**Symptom:** API returns 401 even though you're logged in
**Fix:**
- Check browser cookies for `sb-*-auth-token`
- Try clearing cookies and logging in again
- Check if using incognito/private mode

### Issue 4: API Returns Data But UI Empty
**Symptom:** Console shows data but UI shows "No followers yet"
**Fix:**
- Check browser console for React errors
- Look for warnings about missing keys (should be fixed)
- Verify state is being set correctly (check React DevTools)

## 🐛 Current Code Status

### Files Modified (Latest):
1. **`src/app/app/followers/page.tsx`**
   - Added React keys: `<div key={f.id}>`
   - Added null checks before rendering
   - Added console logs for debugging
   - Fixed renderProfileCard to not have duplicate key

2. **`src/app/debug-followers/page.tsx`** (NEW)
   - Visual debug interface
   - Test API endpoints directly
   - Shows current user info
   - Displays API responses

## 📝 Manual Test Commands

If you prefer command line testing:

```bash
# Test as authenticated user (replace cookie value)
curl -H "Cookie: sb-htwhmdoiszhhmwuflgci-auth-token=YOUR_TOKEN" \
  http://localhost:3003/api/followers?type=followers

# Check what follow data exists
node -e "
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
(async () => {
  const { data } = await supabase.from('follows').select('*');
  console.log(JSON.stringify(data, null, 2));
})();
"
```

## ✅ Next Steps

1. **Visit debug page:** `http://localhost:3003/debug-followers`
2. **Check which user you are**
3. **Test API endpoints** using the buttons
4. **Compare results** with expected data above
5. **Report findings:** Which user are you? What does the API return?

The data IS in the database. The API IS working. We just need to identify why the specific user you're logged in as isn't seeing the expected results.
