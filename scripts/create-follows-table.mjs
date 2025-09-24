import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function createFollowsTable() {
  try {
    console.log('Creating follows table...');
    
    // Create follows table
    const { error: createError } = await supabase
      .from('follows')
      .select('*')
      .limit(1);
    
    if (createError && createError.code === '42P01') { // Table does not exist
      console.log('Table does not exist, creating...');
      
      // Use raw SQL to create the table
      const { data, error } = await supabase.rpc('exec', {
        sql: `
          -- Create follows table for athlete following relationships
          CREATE TABLE follows (
            id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
            follower_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
            following_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
            
            -- Ensure unique follow relationships
            UNIQUE(follower_id, following_id),
            
            -- Prevent self-follows
            CHECK (follower_id != following_id)
          );

          -- Add indexes for performance
          CREATE INDEX follows_follower_id_idx ON follows(follower_id);
          CREATE INDEX follows_following_id_idx ON follows(following_id);
          CREATE INDEX follows_created_at_idx ON follows(created_at DESC);

          -- Enable RLS
          ALTER TABLE follows ENABLE ROW LEVEL SECURITY;

          -- RLS Policies
          -- Users can view all follow relationships (public data)
          CREATE POLICY "Users can view all follows" ON follows
            FOR SELECT USING (true);

          -- Users can only create follows where they are the follower
          CREATE POLICY "Users can create their own follows" ON follows
            FOR INSERT WITH CHECK (auth.uid() = follower_id);

          -- Users can only delete follows where they are the follower
          CREATE POLICY "Users can delete their own follows" ON follows
            FOR DELETE USING (auth.uid() = follower_id);
        `
      });
      
      if (error) {
        console.error('Error creating table:', error);
      } else {
        console.log('✓ Follows table created successfully');
      }
    } else {
      console.log('✓ Follows table already exists');
    }
    
  } catch (error) {
    console.error('Script failed:', error);
  }
}

createFollowsTable();