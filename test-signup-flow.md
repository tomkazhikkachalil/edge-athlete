# Signup Flow Test Checklist

## Required Fields in Form:
1. ✅ First Name (firstName)
2. ✅ Last Name (lastName)
3. ✅ Handle (@handle)
4. ✅ Email (email)
5. ✅ Password (password, min 6 chars)
6. ✅ Confirm Password (confirmPassword)

## Optional Fields:
- Nickname (nickname)
- Phone (phone)
- Birthday (birthday)
- Gender (gender: 'male' | 'female' | 'custom')
- Location (location)
- Postal Code (postalCode)

## Data Flow:

### 1. Form Submission (src/app/page.tsx)
```
formData → API Request
{
  email: string,
  password: string,
  profileData: {
    first_name: firstName,
    last_name: lastName,
    nickname: nickname,
    phone: phone,
    birthday: birthday,
    gender: gender,
    location: location,
    postal_code: postalCode,
    user_type: 'athlete',
    handle: handle
  }
}
```

### 2. API Processing (src/app/api/signup/route.ts)
- Check for duplicate emails
- Create auth user via Supabase Auth
- Wait 100ms for database trigger
- Check if profile exists
- INSERT or UPDATE profile with all data
- Handle errors with specific messages

### 3. Database Trigger (supabase-setup.sql)
```sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, user_type)
  VALUES (new.id, new.email, 'athlete');
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### 4. Profile Table Fields Saved:
- id (from auth.users)
- email (lowercase)
- first_name
- last_name
- nickname
- phone
- birthday
- dob (same as birthday)
- gender
- location
- postal_code
- user_type ('athlete')
- full_name (generated from first_name + last_name)
- handle (lowercase, trimmed)

## Test Steps:

1. Fill out all required fields
2. Submit form
3. Check server logs for:
   - [SIGNUP] Starting signup process
   - [SIGNUP] Profile data received
   - [SIGNUP] Creating auth user
   - [SIGNUP] Auth signup result
   - [SIGNUP] Updating profile for user
   - [SIGNUP] Profile exists check
   - [SIGNUP] Profile data to save
   - [SIGNUP] Profile updated successfully
   - [SIGNUP] Signup completed successfully

4. Verify in database:
   - auth.users has new entry
   - profiles has new entry with all fields
   - handle is unique and lowercase

## Expected Success Message:
"Account created successfully! Please sign in to continue."

## Common Errors & Solutions:

### "Database error saving new user"
- Check server logs for specific error
- Verify supabaseAdmin is configured (SUPABASE_SERVICE_ROLE_KEY)
- Check database trigger exists
- Verify profiles table schema

### "This handle is already taken"
- Handle must be unique
- Try different handle

### "Required profile information is missing"
- Ensure all required fields are filled
- Check form validation
