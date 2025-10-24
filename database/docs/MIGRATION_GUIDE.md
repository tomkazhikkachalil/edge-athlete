# Database Migration Guide

## Overview
This guide explains how to set up, migrate, and maintain the Edge Athlete database.

## Prerequisites
- Supabase project created
- Supabase CLI installed (`npm install -g supabase`)
- Database connection details (URL, service role key)

## Running Migrations

### Option 1: Supabase SQL Editor (Recommended for Production)
1. Open your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Copy the contents of each migration file in order
4. Paste and execute in the SQL Editor

### Option 2: Supabase CLI
```bash
# Connect to your project
supabase link --project-ref YOUR_PROJECT_REF

# Run a migration
supabase db execute -f database/migrations/001_initial_setup.sql

# Or run all migrations in order
for file in database/migrations/*.sql; do
  echo "Running $file..."
  supabase db execute -f "$file"
done
```

### Option 3: psql (Direct PostgreSQL)
```bash
# Using environment variables
psql "$DATABASE_URL" < database/migrations/001_initial_setup.sql

# Or with connection details
psql -h db.xxx.supabase.co -p 5432 -U postgres -d postgres < database/migrations/001_initial_setup.sql
```

## Migration Order

**Critical**: Run migrations in numerical order!

1. `001_initial_setup.sql` - Core tables, RLS, storage
2. `002_golf_schema.sql` - Golf feature
3. `003_notifications.sql` - Notification system
4. `004_group_posts.sql` - Shared scorecards
5. `005_name_migration.sql` - Name structure update
6. `006_handles_system.sql` - @handle usernames
7. `007_saved_posts.sql` - Bookmark feature
8. `008_tagging_system.sql` - User tagging

## Verifying Migrations

After running migrations, verify the database:

```bash
# Check tables exist
psql "$DATABASE_URL" < database/tests/verification/verify-database-setup.sql

# Verify counts
psql "$DATABASE_URL" < database/tests/verification/check-counts.sql

# Full database status
psql "$DATABASE_URL" < database/tests/verification/check-database-status.sql
```

## Adding New Migrations

### 1. Create Migration File
```bash
# Name format: XXX_descriptive_name.sql
touch database/migrations/009_new_feature.sql
```

### 2. Write Idempotent SQL
```sql
-- Use IF NOT EXISTS for safety
CREATE TABLE IF NOT EXISTS new_table (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- columns...
);

-- Drop and recreate functions (they're idempotent)
DROP FUNCTION IF EXISTS my_function();
CREATE FUNCTION my_function() ...
```

### 3. Test Migration
```bash
# Test on development database first
supabase db execute -f database/migrations/009_new_feature.sql
```

### 4. Document Migration
Add entry to `/database/migrations/INDEX.md`

## Common Migration Tasks

### Adding a Column
```sql
ALTER TABLE profiles
ADD COLUMN IF NOT EXISTS new_column TEXT;
```

### Adding RLS Policy
```sql
-- Use (select auth.uid()) for performance
CREATE POLICY "Users can read own data"
  ON table_name FOR SELECT
  USING (user_id = (select auth.uid()));
```

### Creating Indexes
```sql
CREATE INDEX IF NOT EXISTS idx_table_column
  ON table_name(column);
```

### Updating Functions
```sql
-- Always drop first for clean updates
DROP FUNCTION IF EXISTS function_name(args);

CREATE FUNCTION function_name(args)
RETURNS return_type
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''  -- Important for security
AS $$
BEGIN
  -- Use fully qualified table names
  SELECT * FROM public.table_name;
END;
$$;
```

## Rollback Strategy

### Manual Rollback
1. Identify changes from migration file
2. Write reverse SQL statements
3. Test on development database first

### Example Rollback
```sql
-- If migration added a column
ALTER TABLE profiles DROP COLUMN IF EXISTS new_column;

-- If migration created a table
DROP TABLE IF EXISTS new_table CASCADE;

-- If migration created a function
DROP FUNCTION IF EXISTS new_function();
```

## Troubleshooting

### Migration Fails
1. Check error message in SQL Editor
2. Run diagnostic scripts:
   ```bash
   psql "$DATABASE_URL" < database/tests/diagnostics/diagnose-rls-columns.sql
   ```
3. Review migration for syntax errors
4. Check dependencies (required tables/functions exist)

### RLS Issues
```bash
# Find RLS problems
psql "$DATABASE_URL" < database/archive/old-migrations/find-rls-issues.sql

# Verify RLS fix
psql "$DATABASE_URL" < database/tests/verification/verify-rls-fix.sql
```

### Performance Issues
```bash
# Check Supabase Performance Advisor
# Run performance index migration if needed
psql "$DATABASE_URL" < database/archive/old-migrations/add-performance-indexes.sql
```

## Best Practices

### ✅ Do:
- Run migrations in numerical order
- Test on development database first
- Use `IF NOT EXISTS` clauses
- Write idempotent migrations
- Document changes in INDEX.md
- Use fully qualified table names in functions
- Set `search_path = ''` in functions for security

### ❌ Don't:
- Skip migration numbers
- Modify existing migration files (create new ones instead)
- Run migrations in production without testing
- Use `CASCADE` without understanding impact
- Hard-code values that should be configurable
- Re-run old migrations on existing databases

## Environment-Specific Notes

### Development
- Feel free to experiment with `/tests/test-data/` scripts
- Use diagnostic scripts liberally
- Can reset database and re-run all migrations

### Staging
- Run migrations exactly as planned for production
- Verify with full test suite
- Time migration execution

### Production
- **Always backup database first**
- Run during low-traffic period
- Have rollback plan ready
- Monitor for errors immediately after
- Run verification scripts after completion

## Migration Checklist

Before running in production:

- [ ] Migration tested on development
- [ ] Migration tested on staging
- [ ] Database backup created
- [ ] Rollback plan prepared
- [ ] Team notified of migration window
- [ ] Verification scripts ready
- [ ] Monitoring dashboard open

## Getting Help

1. Review `/database/docs/README.md`
2. Check `/database/migrations/INDEX.md` for similar migrations
3. Search `/database/archive/` for historical context
4. Use `/database/tests/diagnostics/` for debugging
5. Consult Supabase documentation: https://supabase.com/docs
