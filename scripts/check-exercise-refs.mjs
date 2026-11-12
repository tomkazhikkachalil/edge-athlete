#!/usr/bin/env node
/**
 * `node scripts/check-exercise-refs.mjs` — does every stored
 * `workout_exercises.exercise_ref` equal what the TypeScript rule says for
 * that row's key and name? (Training redesign PR 2, migration 306.) The
 * column is an index filter written by the route and backfilled once in SQL;
 * this is the proof that the SQL slug and the TypeScript slug agree on REAL
 * rows. READ-ONLY. Staging by default (.env.local); `TARGET_ENV=prod` reads
 * production (.env.prod). Exit 1 on any mismatch; NULL refs are counted, not
 * failed (307 heals them).
 *
 * The rule itself is imported from src/lib/workouts/exercise-identity.ts
 * (zero-import, so Node reads it directly); the catalog and the aliases are
 * read out of src/lib/workout-config.ts by shape.
 */
import { readFileSync } from 'fs';

const prod = process.env.TARGET_ENV === 'prod';
const env = {};
for (const line of readFileSync(prod ? '.env.prod' : '.env.local', 'utf8').split('\n')) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('✗ NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');
  process.exit(1);
}

const { buildSlugToKey, exerciseRef } = await import('../src/lib/workouts/exercise-identity.ts');
const config = readFileSync('src/lib/workout-config.ts', 'utf8');
const catalog = [...config.matchAll(/\{ key: '([a-z0-9_]+)', label: '([^']+)'/g)].map(m => ({ key: m[1], label: m[2] }));
const aliasBlock = config.split('EXERCISE_ALIASES')[1]?.split('};')[0] ?? '';
const aliases = Object.fromEntries([...aliasBlock.matchAll(/^\s+([a-z0-9_]+): '([a-z0-9_]+)',/gm)].map(m => [m[1], m[2]]));
if (catalog.length < 40 || Object.keys(aliases).length < 10) {
  console.error(`✗ could not read the catalog out of workout-config.ts (${catalog.length} exercises, ${Object.keys(aliases).length} aliases)`);
  process.exit(1);
}
const slugToKey = buildSlugToKey(catalog, aliases);

const PAGE = 1000;
let rows = 0;
let nulls = 0;
const wrong = [];
for (let from = 0; ; from += PAGE) {
  const res = await fetch(`${url}/rest/v1/workout_exercises?select=id,exercise_key,name,exercise_ref&order=id.asc`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + PAGE - 1}`, 'Range-Unit': 'items' },
  });
  if (!res.ok) {
    console.error(`✗ read failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    process.exit(1);
  }
  const page = await res.json();
  for (const r of page) {
    rows++;
    if (r.exercise_ref === null) {
      nulls++;
      continue;
    }
    const expected = exerciseRef(r.exercise_key, r.name, slugToKey);
    if (expected !== r.exercise_ref && wrong.length < 20) wrong.push({ id: r.id, key: r.exercise_key, stored: r.exercise_ref, expected });
    else if (expected !== r.exercise_ref) wrong.push(null);
  }
  if (page.length < PAGE) break;
}

console.log(`check-exercise-refs (${prod ? 'PRODUCTION' : 'staging'}): ${rows} rows, ${nulls} without a reference, ${wrong.length} that differ from the TypeScript rule`);
for (const w of wrong.filter(Boolean)) console.log(`  ${w.id}  key=${w.key ?? '∅'}  stored=${JSON.stringify(w.stored)}  expected=${JSON.stringify(w.expected)}`);
if (wrong.length > 0) process.exit(1);
console.log('✓ every stored reference is the one the rule gives');
