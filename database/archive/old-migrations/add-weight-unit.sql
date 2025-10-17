-- Add weight_unit column to store user's preferred unit
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS weight_unit TEXT DEFAULT 'lbs';

-- Also change weight_kg to DECIMAL for more precision
ALTER TABLE profiles ALTER COLUMN weight_kg TYPE DECIMAL(5,2);