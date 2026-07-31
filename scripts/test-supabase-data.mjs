#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '..', '.env') });
dotenv.config({ path: join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

console.log('🔍 Environment Check:');
console.log('  Supabase URL:', supabaseUrl ? '✅' : '❌');
console.log('  Anon Key:', supabaseAnonKey ? '✅' : '❌');
console.log('  Service Key:', supabaseServiceKey ? '✅' : '❌');

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing required environment variables');
  console.log('\n📝 Required variables:');
  console.log('  NEXT_PUBLIC_SUPABASE_URL');
  console.log('  SUPABASE_SERVICE_ROLE_KEY');
  console.log('\nCheck your .env.local file');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

// Color codes for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function testDatabaseConnection() {
  log('\n🔌 Testing Database Connection...', 'cyan');
  
  try {
    const { error } = await supabase
      .from('profiles')
      .select('count')
      .limit(1);
    
    if (error) {
      log(`❌ Connection failed: ${error.message}`, 'red');
      return false;
    }
    
    log('✅ Database connection successful', 'green');
    return true;
  } catch (error) {
    log(`❌ Connection error: ${error.message}`, 'red');
    return false;
  }
}

async function testTableStructure() {
  log('\n🏗️ Testing Table Structure...', 'cyan');
  
  const tables = [
    'profiles',
    'athlete_badges', 
    'athlete_vitals',
    'athlete_socials',
    'athlete_performances',
    'athlete_season_highlights'
  ];
  
  const results = [];
  
  for (const table of tables) {
    try {
      const { error } = await supabase
        .from(table)
        .select('*')
        .limit(1);
      
      if (error) {
        log(`  ❌ ${table}: ${error.message}`, 'red');
        results.push(false);
      } else {
        log(`  ✅ ${table}: Table accessible`, 'green');
        results.push(true);
      }
    } catch (error) {
      log(`  ❌ ${table}: ${error.message}`, 'red');
      results.push(false);
    }
  }
  
  return results.every(r => r);
}

async function testStorageBucket() {
  log('\n📁 Testing Storage Bucket...', 'cyan');
  
  try {
    const { data, error } = await supabase.storage
      .listBuckets();
    
    if (error) {
      log(`❌ Storage error: ${error.message}`, 'red');
      return false;
    }
    
    const uploadsBucket = data.find(bucket => bucket.id === 'uploads');
    if (uploadsBucket) {
      log('✅ Uploads bucket exists and is accessible', 'green');
      return true;
    } else {
      log('❌ Uploads bucket not found', 'red');
      log('Available buckets:', 'yellow');
      data.forEach(bucket => {
        log(`  - ${bucket.id} (public: ${bucket.public})`, 'yellow');
      });
      return false;
    }
  } catch (error) {
    log(`❌ Storage test failed: ${error.message}`, 'red');
    return false;
  }
}

async function createTestUser() {
  log('\n👤 Creating Test User...', 'cyan');
  
  const testEmail = `test-${Date.now()}@athlete-test.com`;
  const testUserId = `test-user-${Date.now()}`;
  
  try {
    // Create auth user
    const { error: authError } = await supabase.auth.admin
      .createUser({
        id: testUserId,
        email: testEmail,
        email_confirm: true
      });
    
    if (authError) {
      log(`❌ Auth user creation failed: ${authError.message}`, 'red');
      return null;
    }
    
    // Create profile
    const { error: profileError } = await supabase
      .from('profiles')
      .insert({
        id: testUserId,
        email: testEmail,
        display_name: 'Test Athlete',
        sport: 'Track & Field'
      })
      .select()
      .single();
    
    if (profileError) {
      log(`❌ Profile creation failed: ${profileError.message}`, 'red');
      // Clean up auth user
      await supabase.auth.admin.deleteUser(testUserId);
      return null;
    }
    
    log(`✅ Test user created: ${testUserId}`, 'green');
    return testUserId;
    
  } catch (error) {
    log(`❌ Test user creation error: ${error.message}`, 'red');
    return null;
  }
}

async function testDataOperations(userId) {
  log('\n🔄 Testing Data Operations...', 'cyan');
  
  const tests = [];
  
  // Test 1: Add badge
  try {
    const { data: badgeData, error: badgeError } = await supabase
      .from('athlete_badges')
      .insert({
        user_id: userId,
        badge_type: 'test_badge',
        display_order: 1
      })
      .select()
      .single();
    
    if (badgeError) {
      log(`  ❌ Badge insert failed: ${badgeError.message}`, 'red');
      tests.push(false);
    } else {
      log(`  ✅ Badge created: ${badgeData.id}`, 'green');
      tests.push(true);
    }
  } catch (error) {
    log(`  ❌ Badge test error: ${error.message}`, 'red');
    tests.push(false);
  }
  
  // Test 2: Add vitals
  try {
    const { data: vitalsData, error: vitalsError } = await supabase
      .from('athlete_vitals')
      .insert({
        user_id: userId,
        height_feet: 6,
        height_inches: 2,
        weight_display: 185,
        weight_unit: 'lbs'
      })
      .select()
      .single();
    
    if (vitalsError) {
      log(`  ❌ Vitals insert failed: ${vitalsError.message}`, 'red');
      tests.push(false);
    } else {
      log(`  ✅ Vitals created: ${vitalsData.id}`, 'green');
      tests.push(true);
    }
  } catch (error) {
    log(`  ❌ Vitals test error: ${error.message}`, 'red');
    tests.push(false);
  }
  
  // Test 3: Add performance
  try {
    const { data: perfData, error: perfError } = await supabase
      .from('athlete_performances')
      .insert({
        user_id: userId,
        event_name: '100m Sprint',
        result: '10.5s',
        place: 2,
        date: '2024-01-15',
        location: 'Test Meet'
      })
      .select()
      .single();
    
    if (perfError) {
      log(`  ❌ Performance insert failed: ${perfError.message}`, 'red');
      tests.push(false);
    } else {
      log(`  ✅ Performance created: ${perfData.id}`, 'green');
      tests.push(true);
    }
  } catch (error) {
    log(`  ❌ Performance test error: ${error.message}`, 'red');
    tests.push(false);
  }
  
  // Test 4: Add season highlight
  try {
    const { data: highlightData, error: highlightError } = await supabase
      .from('athlete_season_highlights')
      .insert({
        user_id: userId,
        stat_name: 'Personal Best',
        stat_value: '10.5s',
        stat_context: '100m Sprint',
        display_order: 1
      })
      .select()
      .single();
    
    if (highlightError) {
      log(`  ❌ Highlight insert failed: ${highlightError.message}`, 'red');
      tests.push(false);
    } else {
      log(`  ✅ Highlight created: ${highlightData.id}`, 'green');
      tests.push(true);
    }
  } catch (error) {
    log(`  ❌ Highlight test error: ${error.message}`, 'red');
    tests.push(false);
  }
  
  // Test 5: Add social link
  try {
    const { data: socialData, error: socialError } = await supabase
      .from('athlete_socials')
      .insert({
        user_id: userId,
        platform: 'twitter',
        handle: '@testathlete'
      })
      .select()
      .single();
    
    if (socialError) {
      log(`  ❌ Social insert failed: ${socialError.message}`, 'red');
      tests.push(false);
    } else {
      log(`  ✅ Social created: ${socialData.id}`, 'green');
      tests.push(true);
    }
  } catch (error) {
    log(`  ❌ Social test error: ${error.message}`, 'red');
    tests.push(false);
  }
  
  return tests.every(t => t);
}

async function testDataRetrieval(userId) {
  log('\n📊 Testing Data Retrieval...', 'cyan');
  
  try {
    // Get all athlete data for user
    const [
      { data: profile },
      { data: badges },
      { data: vitals },
      { data: socials },
      { data: performances },
      { data: highlights }
    ] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).single(),
      supabase.from('athlete_badges').select('*').eq('user_id', userId),
      supabase.from('athlete_vitals').select('*').eq('user_id', userId),
      supabase.from('athlete_socials').select('*').eq('user_id', userId),
      supabase.from('athlete_performances').select('*').eq('user_id', userId),
      supabase.from('athlete_season_highlights').select('*').eq('user_id', userId)
    ]);
    
    log(`  ✅ Profile: ${profile ? 'Found' : 'Missing'}`, profile ? 'green' : 'red');
    log(`  ✅ Badges: ${badges?.length || 0} found`, 'green');
    log(`  ✅ Vitals: ${vitals?.length || 0} found`, 'green');
    log(`  ✅ Socials: ${socials?.length || 0} found`, 'green');
    log(`  ✅ Performances: ${performances?.length || 0} found`, 'green');
    log(`  ✅ Highlights: ${highlights?.length || 0} found`, 'green');
    
    return true;
    
  } catch (error) {
    log(`  ❌ Retrieval test failed: ${error.message}`, 'red');
    return false;
  }
}

async function cleanupTestUser(userId) {
  log('\n🧹 Cleaning Up Test Data...', 'cyan');
  
  try {
    // Delete from all tables (order matters due to foreign keys)
    const tables = [
      'athlete_badges',
      'athlete_vitals', 
      'athlete_socials',
      'athlete_performances',
      'athlete_season_highlights',
      'profiles'
    ];
    
    for (const table of tables) {
      await supabase.from(table).delete().eq('user_id', userId);
    }
    
    // Delete auth user
    await supabase.auth.admin.deleteUser(userId);
    
    log('✅ Test data cleaned up', 'green');
    return true;
    
  } catch (error) {
    log(`❌ Cleanup failed: ${error.message}`, 'red');
    return false;
  }
}

async function runAllTests() {
  log('🚀 SUPABASE DATA VALIDATION TEST SUITE', 'magenta');
  log('=' .repeat(50), 'magenta');
  
  const results = [];
  let testUserId = null;
  
  try {
    // Test 1: Connection
    results.push(await testDatabaseConnection());
    
    // Test 2: Table structure
    results.push(await testTableStructure());
    
    // Test 3: Storage
    results.push(await testStorageBucket());
    
    // Test 4: Create test user
    testUserId = await createTestUser();
    results.push(!!testUserId);
    
    if (testUserId) {
      // Test 5: Data operations
      results.push(await testDataOperations(testUserId));
      
      // Test 6: Data retrieval
      results.push(await testDataRetrieval(testUserId));
    }
    
    // Summary
    log('\n' + '='.repeat(50), 'magenta');
    log('📊 TEST RESULTS SUMMARY', 'magenta');
    log('=' .repeat(50), 'magenta');
    
    const allPassed = results.every(r => r);
    const passedCount = results.filter(r => r).length;
    const totalCount = results.length;
    
    if (allPassed) {
      log(`✅ All tests passed! (${passedCount}/${totalCount})`, 'green');
      log('\n🎉 Your Supabase database is fully configured and working!', 'green');
      log('\nNext steps:', 'cyan');
      log('  1. Start your app: npm run dev', 'cyan');
      log('  2. Navigate to /athlete', 'cyan');
      log('  3. Test the full user interface', 'cyan');
    } else {
      log(`❌ Some tests failed (${passedCount}/${totalCount})`, 'red');
      log('\n🔧 Troubleshooting steps:', 'yellow');
      log('  1. Check your .env.local file', 'yellow');
      log('  2. Run the schema setup script in Supabase', 'yellow');
      log('  3. Verify RLS policies in Supabase dashboard', 'yellow');
      log('  4. Check the error messages above', 'yellow');
    }
    
    return allPassed;
    
  } finally {
    // Always cleanup
    if (testUserId) {
      await cleanupTestUser(testUserId);
    }
  }
}

// Run the tests
runAllTests()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    log(`\n💥 Test suite crashed: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
  });