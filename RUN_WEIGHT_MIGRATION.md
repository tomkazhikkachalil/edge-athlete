# Weight Unit Migration Instructions

## ⚠️ IMPORTANT: Database Migration Required

**The weight feature will NOT work properly until you run this migration!**

To support the new weight unit selector feature, you need to run a database migration in your Supabase project.

### Steps to Apply the Migration:

1. **Open your Supabase Dashboard**
   - Go to https://app.supabase.com
   - Select your project

2. **Navigate to SQL Editor**
   - Click on "SQL Editor" in the left sidebar

3. **Run the Migration**
   - Copy and paste this SQL:

```sql
-- Add weight_unit column to store user's preferred unit
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS weight_unit TEXT DEFAULT 'lbs';

-- Also change weight_kg to DECIMAL for more precision
ALTER TABLE profiles ALTER COLUMN weight_kg TYPE DECIMAL(5,2);
```

4. **Click "Run"** to execute the migration

### What This Does:
- Adds a `weight_unit` column to store each user's preferred weight unit (lbs, kg, or stone)
- Changes `weight_kg` from INTEGER to DECIMAL for better precision
- Sets the default unit to 'lbs' for existing users

### Testing the Feature:
1. Go to your athlete profile page
2. Click "Edit Profile"
3. Navigate to the "Vitals" tab
4. You'll see a weight input field with a unit selector dropdown
5. Enter weight in your preferred unit
6. The unit preference is saved and remembered for future edits

### Important Notes:
- Weight is always stored in kg in the database (standard practice)
- The display unit is stored separately in `weight_unit`
- When you change units in the dropdown, the number you typed stays the same (no conversion)
- The athlete profile page will display weight in the saved unit preference