# Tagging System - Quick Start Guide

## ⚡ 5-Minute Setup

### 1. Run Database Migration (Required)
```bash
# Open Supabase Dashboard > SQL Editor
# Run the file: setup-tagging-system.sql
```

### 2. Tag People in Posts
```typescript
// Option A: During post creation
const response = await fetch('/api/posts', {
  method: 'POST',
  body: JSON.stringify({
    caption: 'Great game!',
    taggedProfiles: ['user-id-1', 'user-id-2'] // <-- Add this
  })
});

// Option B: Add tag modal to existing post
import TagPeopleModal from '@/components/TagPeopleModal';

<TagPeopleModal
  isOpen={true}
  onClose={() => {}}
  postId="post-id"
  onTagsAdded={() => console.log('Tagged!')}
/>
```

### 3. Show Tagged Posts on Profile
```typescript
import TaggedPosts from '@/components/TaggedPosts';

<TaggedPosts profileId={athleteId} currentUserId={userId} />
```

---

## 📡 API Endpoints

### Create Tags
```typescript
POST /api/tags
{
  postId: "uuid",
  tags: [
    { taggedProfileId: "uuid" },
    { taggedProfileId: "uuid", mediaId: "uuid", positionX: 50, positionY: 50 }
  ]
}
```

### Get Tags for Post
```typescript
GET /api/tags?postId=xxx
// Returns: { tags: [...] }
```

### Get Tagged Posts for Profile
```typescript
GET /api/tags?profileId=xxx
// Returns: { tags: [...] }
```

### Remove Tag
```typescript
DELETE /api/tags?tagId=xxx
// Creator or tagged person can remove
```

---

## 🎯 What Happens Automatically

✅ **Notification sent** when someone is tagged
✅ **Tagged post appears** on user's profile
✅ **Duplicate prevention** - can't tag same person twice
✅ **Privacy respected** - private posts stay private
✅ **Cascade delete** - tags removed when post deleted

---

## 🔑 Key Features

| Feature | Status |
|---------|--------|
| Tag people in posts | ✅ Ready |
| Tag people in specific photos | ✅ Ready |
| Notifications | ✅ Auto-sent |
| Tagged posts on profile | ✅ Component ready |
| Remove tags | ✅ API ready |
| Privacy controls | ✅ RLS enabled |
| Prevent duplicates | ✅ Database constraint |

---

## 🚀 Next Steps

1. **Run the SQL migration** (`setup-tagging-system.sql`)
2. **Add UI** - Place `TagPeopleModal` button on PostCard
3. **Add profile tab** - Show `TaggedPosts` on athlete profiles
4. **Test it** - Tag someone and verify notification

See `TAGGING_SYSTEM_GUIDE.md` for complete documentation.
