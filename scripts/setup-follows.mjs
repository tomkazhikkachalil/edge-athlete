import { createClient } from '@supabase/supabase-js';

// Load environment from .env.local
import { readFileSync } from 'fs';
const envContent = readFileSync('.env.local', 'utf8');
const envVars = {};
envContent.split('\n').forEach(line => {
  const [key, value] = line.split('=');
  if (key && value) {
    envVars[key] = value;
  }
});

const supabaseUrl = envVars.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = envVars.SUPABASE_SERVICE_ROLE_KEY;

console.log('URL:', supabaseUrl ? 'loaded' : 'missing');
console.log('Key:', supabaseServiceKey ? 'loaded' : 'missing');

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function setupFollows() {
  try {
    console.log('Creating follows table...');
    
    // Create the table with SQL
    const { data, error } = await supabase.rpc('execute_sql', {
      query: `
        CREATE TABLE IF NOT EXISTS follows (
          id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
          follower_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
          following_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
          UNIQUE(follower_id, following_id),
          CHECK (follower_id != following_id)
        );
        
        CREATE INDEX IF NOT EXISTS follows_follower_id_idx ON follows(follower_id);
        CREATE INDEX IF NOT EXISTS follows_following_id_idx ON follows(following_id);
        
        ALTER TABLE follows ENABLE ROW LEVEL SECURITY;
        
        DROP POLICY IF EXISTS "Users can view all follows" ON follows;
        CREATE POLICY "Users can view all follows" ON follows FOR SELECT USING (true);
        
        DROP POLICY IF EXISTS "Users can create their own follows" ON follows;
        CREATE POLICY "Users can create their own follows" ON follows FOR INSERT WITH CHECK (auth.uid() = follower_id);
        
        DROP POLICY IF EXISTS "Users can delete their own follows" ON follows;
        CREATE POLICY "Users can delete their own follows" ON follows FOR DELETE USING (auth.uid() = follower_id);
      `
    });
    
    if (error) {
      console.error('SQL Error:', error);
    } else {
      console.log('✓ Follows table setup complete');
    }
    
  } catch (error) {
    console.error('Setup failed:', error);
  }
}

setupFollows();