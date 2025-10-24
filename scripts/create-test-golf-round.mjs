#!/usr/bin/env node

/**
 * Diagnostic script to check golf rounds and create a test round if needed
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  console.log('\n🔍 Checking golf rounds in database...\n');

  // Check existing golf rounds (use SELECT * to avoid column mismatch)
  const { data: rounds, error: roundsError } = await supabase
    .from('golf_rounds')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5);

  if (roundsError) {
    console.error('❌ Error fetching golf rounds:', roundsError);
    return;
  }

  console.log(`Found ${rounds.length} golf rounds:`);
  if (rounds.length > 0) {
    console.log('\n📋 First round schema (to see column names):');
    console.log(JSON.stringify(rounds[0], null, 2));
  }
  rounds.forEach((round, i) => {
    const score = round.gross_score || round.total_score || 'N/A';
    console.log(`\n  ${i + 1}. ${round.course || 'Unnamed Course'}`);
    console.log(`     Score: ${score}, Par: ${round.par}, Holes: ${round.holes}`);
    console.log(`     ID: ${round.id}`);
    console.log(`     Profile: ${round.profile_id}`);
  });

  // Check posts with round_id
  console.log('\n🔍 Checking posts with round_id...\n');
  const { data: posts, error: postsError } = await supabase
    .from('posts')
    .select('id, round_id, caption, profile_id, created_at')
    .not('round_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(5);

  if (postsError) {
    console.error('❌ Error fetching posts:', postsError);
    return;
  }

  console.log(`Found ${posts.length} posts with round_id:`);
  posts.forEach((post, i) => {
    const matchingRound = rounds.find(r => r.id === post.round_id);
    console.log(`  ${i + 1}. Post ID: ${post.id.substring(0, 8)}...`);
    console.log(`     Round ID: ${post.round_id}`);
    console.log(`     Round exists: ${matchingRound ? '✅ YES' : '❌ NO (orphaned)'}`);
    if (matchingRound) {
      console.log(`     Course: ${matchingRound.course}`);
    }
  });

  // Get current user profile to create test round
  console.log('\n🔍 Finding a profile to create test round...\n');
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, first_name, last_name, full_name')
    .limit(1);

  if (profilesError || !profiles || profiles.length === 0) {
    console.error('❌ Error finding profile:', profilesError);
    return;
  }

  const testProfile = profiles[0];
  console.log(`Using profile: ${testProfile.first_name} ${testProfile.last_name} (${testProfile.id})`);

  // Create test golf round
  console.log('\n✨ Creating test golf round...\n');
  const testRound = {
    profile_id: testProfile.id,
    course: 'Test Course - Edge Athlete',
    course_location: 'Test Location',
    gross_score: 75,  // Using gross_score instead of total_score
    par: 72,
    holes: 18,
    round_type: 'outdoor',
    total_putts: 32,
    date: new Date().toISOString().split('T')[0]  // Date only
  };

  const { data: newRound, error: createError } = await supabase
    .from('golf_rounds')
    .insert(testRound)
    .select()
    .single();

  if (createError) {
    console.error('❌ Error creating test round:', createError);
    return;
  }

  console.log('✅ Created test golf round:');
  console.log(`   ID: ${newRound.id}`);
  console.log(`   Course: ${newRound.course}`);
  console.log(`   Score: ${newRound.gross_score} (Par ${newRound.par})`);
  console.log(`   Holes: ${newRound.holes}`);

  // Create test post linked to this round
  console.log('\n✨ Creating test post linked to golf round...\n');
  const testPost = {
    profile_id: testProfile.id,
    sport_key: 'golf',
    round_id: newRound.id,
    stats_data: null,  // Stats come from golf_rounds table, not duplicated here
    visibility: 'public',
    caption: null // No caption - stats only!
  };

  const { data: newPost, error: postError } = await supabase
    .from('posts')
    .insert(testPost)
    .select()
    .single();

  if (postError) {
    console.error('❌ Error creating test post:', postError);
    return;
  }

  console.log('✅ Created test post:');
  console.log(`   Post ID: ${newPost.id}`);
  console.log(`   Round ID: ${newPost.round_id}`);
  console.log(`   Sport: ${newPost.sport_key}`);

  console.log('\n✅ SUCCESS! Test data created.\n');
  console.log('📋 Next steps:');
  console.log('   1. Refresh your browser');
  console.log('   2. Go to "My Media" → "Media with Stats"');
  console.log('   3. You should see: "Test Course - Edge Athlete • 75 (+3)"');
  console.log('   4. Secondary line: "18H • GIR 12"\n');
}

main().catch(console.error);
