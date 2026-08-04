-- ============================================
-- ATHLETE EQUIPMENT - DATABASE MIGRATION
-- ============================================
-- Purpose: Store athlete equipment/gear for all sports
-- Date: 2025-01-06
-- ============================================

-- Create athlete_equipment table
CREATE TABLE IF NOT EXISTS athlete_equipment (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,

  -- Sport classification (for future multi-sport support)
  sport_key TEXT DEFAULT 'golf',

  -- Equipment details
  category TEXT NOT NULL,
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  image_url TEXT,
  specs JSONB,

  -- Status tracking
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'retired')),
  added_at TIMESTAMPTZ DEFAULT NOW(),
  retired_at TIMESTAMPTZ,

  -- Additional info
  notes TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_equipment_profile ON athlete_equipment(profile_id);
CREATE INDEX IF NOT EXISTS idx_equipment_status ON athlete_equipment(status);
CREATE INDEX IF NOT EXISTS idx_equipment_sport ON athlete_equipment(sport_key);
CREATE INDEX IF NOT EXISTS idx_equipment_category ON athlete_equipment(category);

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_equipment_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_equipment_updated_at ON athlete_equipment;
CREATE TRIGGER trigger_equipment_updated_at
BEFORE UPDATE ON athlete_equipment
FOR EACH ROW EXECUTE FUNCTION update_equipment_updated_at();

-- Enable RLS
ALTER TABLE athlete_equipment ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- SELECT: Public can see active equipment, owners see all
DROP POLICY IF EXISTS equipment_select_policy ON athlete_equipment;
CREATE POLICY equipment_select_policy ON athlete_equipment
FOR SELECT USING (
  -- Owner can see all their equipment
  profile_id = auth.uid()
  OR
  -- Others can only see active equipment from public profiles
  (
    status = 'active'
    AND EXISTS (
      SELECT 1 FROM profiles
      WHERE id = athlete_equipment.profile_id
      AND visibility = 'public'
    )
  )
);

-- INSERT: Only owners can add equipment
DROP POLICY IF EXISTS equipment_insert_policy ON athlete_equipment;
CREATE POLICY equipment_insert_policy ON athlete_equipment
FOR INSERT WITH CHECK (profile_id = auth.uid());

-- UPDATE: Only owners can update their equipment
DROP POLICY IF EXISTS equipment_update_policy ON athlete_equipment;
CREATE POLICY equipment_update_policy ON athlete_equipment
FOR UPDATE USING (profile_id = auth.uid());

-- DELETE: Only owners can delete their equipment
DROP POLICY IF EXISTS equipment_delete_policy ON athlete_equipment;
CREATE POLICY equipment_delete_policy ON athlete_equipment
FOR DELETE USING (profile_id = auth.uid());

-- ============================================
-- VERIFICATION
-- ============================================

DO $$
BEGIN
  RAISE NOTICE '=== EQUIPMENT TABLE MIGRATION ===';
  RAISE NOTICE 'athlete_equipment table exists: %',
    (SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'athlete_equipment'));
  RAISE NOTICE 'RLS enabled: %',
    (SELECT relrowsecurity FROM pg_class WHERE relname = 'athlete_equipment');
  RAISE NOTICE '=== MIGRATION COMPLETE ===';
END $$;
