import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Migration 238 (departed accounts) pinned: check:schema sees the column, the
 * policy and the functions, but NOT a dropped FK, an FK action or a
 * nullability — so this test holds the file to the statements the deletion
 * engine depends on, and the provenance parser's spelling rules.
 */
const FILE = path.join(process.cwd(), 'database/migrations/238_departed_profiles.sql');
const sql = fs.readFileSync(FILE, 'utf8').replace(/--[^\n]*/g, '');

describe('238_departed_profiles.sql', () => {
  it('adds the stamp in the parser-owned form', () => {
    expect(sql).toMatch(/ALTER TABLE public\.profiles ADD COLUMN IF NOT EXISTS departed_at timestamptz;/);
  });

  it('lets the row outlive its auth user', () => {
    expect(sql).toMatch(/ALTER TABLE public\.profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;/);
  });

  it('keeps the dataset and severs the person (named ADD CONSTRAINT — the parser trap)', () => {
    expect(sql).toMatch(/athlete_performances ALTER COLUMN profile_id DROP NOT NULL/);
    expect(sql).toMatch(/ADD CONSTRAINT athlete_performances_profile_id_fkey\s+FOREIGN KEY \(profile_id\) REFERENCES public\.profiles\(id\) ON DELETE SET NULL/);
    expect(sql).not.toMatch(/ADD FOREIGN KEY/);
  });

  it('search forgets a departed person', () => {
    expect(sql).toMatch(/AND p\.departed_at IS NULL/);
    expect(sql).toMatch(/NEW\.departed_at IS NOT NULL/);
    // the replaced trigger function keeps SECURITY DEFINER (CREATE OR REPLACE resets it)
    expect(sql).toMatch(/FUNCTION public\.search_doc_sync_athlete\(\)\s+RETURNS trigger\s+LANGUAGE plpgsql\s+SECURITY DEFINER/);
    expect(sql).toMatch(/visibility, avatar_url, search_vector, departed_at/);
  });

  it('drops a bell to a departed recipient, locked down', () => {
    expect(sql).toMatch(/BEFORE INSERT ON public\.notifications/);
    expect(sql).toMatch(/notifications_skip_departed\(\)\s+RETURNS trigger\s+LANGUAGE plpgsql\s+SECURITY DEFINER\s+SET search_path = ''/);
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.notifications_skip_departed\(\) FROM PUBLIC, anon, authenticated;/);
  });

  it('records itself in the ledger', () => {
    expect(sql).toMatch(/INSERT INTO public\.schema_migrations \(number, name\) VALUES \(238, '238_departed_profiles\.sql'\) ON CONFLICT \(number\) DO NOTHING;/);
  });
});
