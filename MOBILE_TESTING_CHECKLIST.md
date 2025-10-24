# Mobile Testing Checklist - Golf MVP

## 🎯 Goal
Ensure every critical user flow works perfectly on mobile devices (iPhone SE, iPhone 14 Pro, iPad).

## 📱 Test Devices (Screen Sizes)

Test on these sizes using Chrome DevTools (F12 → Toggle Device Toolbar):

- **iPhone SE** - 375px width (smallest modern iPhone)
- **iPhone 14 Pro** - 393px width (most common)
- **iPad Mini** - 768px width (tablet)
- **Desktop** - 1024px+ (baseline)

## ✅ Critical User Flows to Test

### **1. Signup & Login**

**On iPhone SE (375px):**
- [ ] Homepage loads correctly
- [ ] "Sign Up" button is tappable (min 44px touch target)
- [ ] Signup form is usable
  - [ ] All input fields are visible
  - [ ] Keyboard doesn't obscure inputs
  - [ ] Form submits successfully
- [ ] Login form works
  - [ ] Email/password inputs are usable
  - [ ] "Sign In" button is tappable
  - [ ] Can login successfully

**Issues to watch for:**
- Inputs too small to tap
- Keyboard covering submit button
- Text too small to read
- Horizontal scrolling

---

### **2. Profile Creation (Basic Info)**

**On iPhone SE (375px):**
- [ ] Navigate to Edit Profile
- [ ] Basic Info tab is usable
  - [ ] First Name / Last Name inputs work
  - [ ] Bio textarea is properly sized
  - [ ] Avatar upload button is tappable
  - [ ] Can select photo from phone
  - [ ] Avatar preview displays correctly
- [ ] Save button is visible and tappable
- [ ] Changes persist after save

**Issues to watch for:**
- Avatar upload not working on mobile
- Textarea too small
- Save button hidden below fold

---

### **3. Golf Settings Entry** 🏌️ **CRITICAL**

**On iPhone SE (375px):**
- [ ] Navigate to Edit Profile → Golf tab
- [ ] All golf inputs are usable:
  - [ ] Handicap input (number)
  - [ ] Home Course input (text)
  - [ ] Tee Preference dropdown
  - [ ] Dominant Hand selector
- [ ] Navigate to Equipment tab
- [ ] All equipment inputs are usable:
  - [ ] Driver Brand
  - [ ] Driver Loft
  - [ ] Irons Brand
  - [ ] Putter Brand
  - [ ] Ball Brand
- [ ] Save button works
- [ ] Data persists after refresh

**Issues to watch for:**
- Dropdowns not opening
- Number inputs hard to use
- Text inputs too narrow
- Save button hidden

---

### **4. Golf Round Entry (Scorecard)** 🏌️ **MOST CRITICAL**

**On iPhone SE (375px):**
- [ ] Open golf round form
- [ ] Course search works
  - [ ] Search input is usable
  - [ ] Results dropdown displays correctly
  - [ ] Can select a course
- [ ] Date picker works on mobile
- [ ] Tee box selector is usable
- [ ] Scorecard grid is usable:
  - [ ] Can scroll through holes
  - [ ] Score inputs are tappable (min 44px)
  - [ ] Putts inputs work
  - [ ] Fairway hit buttons are tappable
  - [ ] GIR checkboxes work
- [ ] Can navigate between Front 9 / Back 9 tabs
- [ ] Save round button works
- [ ] Round attaches to post correctly

**Issues to watch for:**
- Scorecard grid too cramped
- Inputs too small to tap accurately
- Horizontal scrolling issues
- Numbers hard to enter on mobile keyboard
- Form doesn't fit on screen

**This is the most complex form - spend extra time here!**

---

### **5. Post Creation with Photos**

**On iPhone SE (375px):**
- [ ] Open create post modal
- [ ] Caption textarea is usable
- [ ] "Add Photos" button works
  - [ ] Can select photos from phone
  - [ ] Photo preview displays
  - [ ] Can upload multiple photos
  - [ ] Photo carousel works (swipe to navigate)
- [ ] Can add hashtags
  - [ ] Hashtag suggestions display correctly
  - [ ] Can tap to add hashtag
- [ ] Can attach golf round
  - [ ] Golf round selector works
  - [ ] Round displays in preview
- [ ] Visibility toggle works (public/private)
- [ ] Post button is tappable
- [ ] Post submits successfully

**Issues to watch for:**
- Photo upload failing on mobile
- Image carousel not swipeable
- Modal too large for screen
- Keyboard covering inputs

---

### **6. Feed Scrolling & Interactions**

**On iPhone SE (375px):**
- [ ] Feed loads correctly
- [ ] Infinite scroll works
- [ ] Post cards display properly:
  - [ ] Avatar images load
  - [ ] Post images load and are sized correctly
  - [ ] Image carousel is swipeable
  - [ ] Text is readable (min 16px)
- [ ] Interaction buttons work:
  - [ ] Like button (heart icon) - tappable
  - [ ] Comment button - opens comment section
  - [ ] Save button (bookmark) - works
  - [ ] Share button - opens share options
- [ ] Comment section works:
  - [ ] Can tap to open comments
  - [ ] Comment input is usable
  - [ ] Can submit comment
  - [ ] Comments display correctly
  - [ ] Can like comments

**Issues to watch for:**
- Images not loading
- Buttons too small to tap
- Comment section doesn't open
- Text too small to read
- Performance issues (laggy scrolling)

---

### **7. Profile Viewing**

**On iPhone SE (375px):**
- [ ] Navigate to another athlete's profile
- [ ] Profile header displays correctly:
  - [ ] Avatar loads
  - [ ] Name is readable
  - [ ] Follow button is tappable
  - [ ] Stats (followers/following) display
- [ ] Profile media tabs work:
  - [ ] All / Stats / Tagged tabs
  - [ ] Media grid displays correctly
  - [ ] Can tap to view full post
- [ ] Bio section is readable
- [ ] Golf settings display (if public)

**Issues to watch for:**
- Profile header too cramped
- Media grid images too small
- Tabs not working on mobile
- Follow button not responding

---

### **8. Navigation & Header**

**On iPhone SE (375px):**
- [ ] Hamburger menu button works
- [ ] Mobile nav drawer opens/closes smoothly
- [ ] All nav links work:
  - [ ] Feed
  - [ ] Profile
  - [ ] Edit Profile
  - [ ] Notifications
  - [ ] Sign Out
- [ ] Search bar is usable
  - [ ] Can tap to activate search
  - [ ] Keyboard doesn't obscure results
  - [ ] Search results are tappable
- [ ] Notification bell works
  - [ ] Badge displays unread count
  - [ ] Dropdown opens correctly
  - [ ] Notifications are readable

**Issues to watch for:**
- Nav drawer doesn't open
- Search results hidden by keyboard
- Notification dropdown off-screen
- Text too small in navigation

---

## 🐛 Common Mobile Issues to Fix

### **Layout Issues:**
- [ ] No horizontal scrolling (everything fits in viewport)
- [ ] Text is readable (min 16px for body, 14px for labels)
- [ ] Touch targets are 44px minimum (iOS guideline)
- [ ] Proper spacing between tappable elements (8px minimum)
- [ ] No content hidden below fold

### **Performance Issues:**
- [ ] Images load within 2 seconds
- [ ] Smooth scrolling (60fps)
- [ ] No janky animations
- [ ] Forms respond immediately to input

### **Input Issues:**
- [ ] Keyboard type matches input (numeric for numbers, email for email)
- [ ] Inputs don't get obscured by keyboard
- [ ] Can dismiss keyboard easily
- [ ] Autofocus works correctly
- [ ] No issues with autocomplete/autofill

### **Media Issues:**
- [ ] Images are properly sized (not too large, causing slow load)
- [ ] Videos play correctly
- [ ] Image carousels are swipeable
- [ ] Pinch-to-zoom works on images

---

## 🛠️ How to Test in Chrome DevTools

1. **Open Chrome DevTools:** Press `F12`
2. **Toggle Device Toolbar:** Click phone icon or press `Ctrl+Shift+M`
3. **Select Device:** Choose "iPhone SE" from dropdown
4. **Reload Page:** Make sure you're seeing mobile version
5. **Test Touch:** Click "Toggle touch simulation" (cursor becomes dot)
6. **Throttle Network:** Set to "Fast 3G" to test slow connections
7. **Test All Flows:** Go through checklist above

### **Testing Tips:**
- Test in **portrait mode** (vertical) primarily
- Test in **landscape mode** for tablets
- Test **offline behavior** (airplane mode)
- Test with **slow network** (3G simulation)
- Use **real device** if possible (iPhone/iPad) for final validation

---

## 📋 Issue Tracking Template

When you find an issue, document it like this:

```
Issue: [Short description]
Device: iPhone SE (375px)
Flow: [e.g., "Golf Round Entry"]
Steps to Reproduce:
  1. Go to Edit Profile
  2. Click Golf tab
  3. Try to enter handicap

Expected: Number keyboard should appear
Actual: Text keyboard appears, making it hard to enter numbers

Priority: Medium
Fix: Add inputMode="numeric" to handicap input
```

---

## ✅ Definition of Done

Mobile testing is complete when:

- [ ] All flows work on iPhone SE (375px)
- [ ] All flows work on iPhone 14 Pro (393px)
- [ ] All flows work on iPad Mini (768px)
- [ ] No horizontal scrolling on any screen
- [ ] All touch targets are 44px minimum
- [ ] All text is readable (16px+ body text)
- [ ] Images load quickly
- [ ] Forms are usable with mobile keyboard
- [ ] No critical bugs found in last 24 hours of testing

---

## 🚀 Next Steps After Mobile Testing

Once mobile is solid:

1. **Phase 3:** User Testing (create 5 test accounts, full user journeys)
2. **Phase 4:** Launch Prep (monitoring, analytics, onboarding)
3. **Launch:** Invite 100 beta golfers! 🎉

---

## 💡 Pro Tips

- **Test on a real iPhone/iPad** if possible - simulators don't catch everything
- **Test in Safari** (not just Chrome) - iOS uses Safari engine
- **Test with actual golfers** - they'll find issues you missed
- **Focus on the scorecard** - that's your differentiator, it MUST work perfectly
- **Don't rush** - mobile issues kill user retention

---

**Start with the golf scorecard form** - that's the most critical flow for your MVP!
