#!/usr/bin/env node
// Multi-course club sweep + curation (migration 125 arc, PR 5).
//
// LINKS sibling golf_courses rows into golf_clubs — never merges or deletes
// rows (a false link is visible and reversible: club_id = null). Three
// phases:
//   A. Catalog-wide sibling sweep: rows within ~2 km whose names share a
//      ≥2-informative-token base and differ only by a SECTION marker
//      (East/West/North/South, "Course N", "Nine(s)", "(Nines a & b)") are
//      proposed as one club. Conservative on purpose — the DEVLOG's import
//      lesson: token overlap collapses real neighbours, so the base must
//      match exactly after stripping markers.
//   B. Report-only: single rows claiming 27/36 holes with no siblings
//      (sections are never invented from thin air).
//   C. Curation: Greensmere (two 18s: Premier, Legacy) and Ottawa Hunt
//      (three nines: North, South, West) built end-to-end, including
//      nulling Ottawa Hunt's FABRICATED 18-hole seed scorecard.
//
// DRY-RUN BY DEFAULT — prints every proposed group for eyeballing.
//   node scripts/golf-club-sweep.mjs            # propose only
//   node scripts/golf-club-sweep.mjs --apply    # write
// Re-runnable: linked groups are skipped, curation upserts by external_id,
// clubs are looked up by exact name before insert. Re-running after OSM
// improves is the intended way to pick up new siblings.
import { readFileSync } from 'fs';

function loadEnv() {
  for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
    if (process.env[key]) continue;
    try {
      for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
        const m = line.match(/^([A-Z_]+)=(.*)$/);
        if (m && m[1] === key) process.env[key] = m[2].trim();
      }
    } catch { /* no .env.local */ }
  }
}
loadEnv();
const U = process.env.NEXT_PUBLIC_SUPABASE_URL;
const K = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!U || !K) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}
const APPLY = process.argv.includes('--apply');
const H = { apikey: K, Authorization: 'Bearer ' + K, 'Content-Type': 'application/json' };

const ok = (m) => console.log('  \x1b[32m✓\x1b[0m ' + m);
const bad = (m) => { console.log('  \x1b[31m✗\x1b[0m ' + m); process.exitCode = 1; };
const note = (m) => console.log('  \x1b[33m•\x1b[0m ' + m);

async function rest(path, init) {
  const res = await fetch(`${U}/rest/v1/${path}`, { headers: H, ...init });
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} -> ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** PostgREST caps pages at 1000 rows — paginate the whole catalog. Falls
 *  back to the pre-125 column set so a DRY RUN works before the migration
 *  (apply mode still requires 125 — the PATCHes reference the columns). */
async function fetchAllCourses() {
  const base = 'id,name,club_name,external_source,external_id,holes_count,lat,lng,city,region,region_code,country,country_code,place_id';
  let cols = `${base},club_id,section_name`;
  const rows = [];
  for (let from = 0; ; from += 1000) {
    let page;
    try {
      page = await rest(`golf_courses?select=${cols}&order=id.asc`, {
        headers: { ...H, Range: `${from}-${from + 999}` },
      });
    } catch (e) {
      if (cols !== base && String(e).includes('42703')) {
        note('migration 125 columns absent — dry-run against pre-125 schema');
        if (APPLY) { bad('cannot APPLY before migration 125 runs'); process.exit(1); }
        cols = base;
        page = await rest(`golf_courses?select=${cols}&order=id.asc`, {
          headers: { ...H, Range: `${from}-${from + 999}` },
        });
      } else throw e;
    }
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows;
}

// ── Name analysis ────────────────────────────────────────────────────────────
const GENERIC = new Set([
  'golf', 'club', 'course', 'country', 'the', 'and', 'at', 'links', 'gc', 'cc',
  'de', 'du', 'des', 'le', 'la', 'les',
]);
const DIRECTIONS = new Set(['north', 'south', 'east', 'west']);

function tokens(name) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Split a course name into a facility BASE and a SECTION label.
 *  Recognised markers (the tidyCourseName vocabulary run in reverse):
 *  "(Course N)" / "(Nines a & b)" parentheticals, trailing "East|West|
 *  North|South [Course|Nine]", trailing "No. N" / "Course N", trailing
 *  "Nine|Nines". Anything else = no section (base is the whole name). */
function splitSection(name) {
  let base = name.trim();
  let section = null;
  const paren = base.match(/\((course \d+|nines? [^)]+)\)\s*$/i);
  if (paren) {
    section = paren[1];
    base = base.slice(0, paren.index).trim();
  } else {
    const tail = base.match(
      /[\s-]+((?:north|south|east|west)(?:\s+(?:course|nine))?|(?:no\.?|number|course)\s*\d+|nines?)\s*$/i
    );
    if (tail) {
      const t = tail[1].toLowerCase();
      // A bare trailing direction is only a section marker when it doesn't
      // look like part of a place name ("West Links" was already excluded by
      // GENERIC 'links'; "North Bay Golf" keeps its direction — it leads).
      section = tail[1];
      base = base.slice(0, tail.index).trim();
      if (!base || tokens(base).filter((x) => !GENERIC.has(x)).length === 0) {
        return { base: name.trim(), section: null };
      }
      if (DIRECTIONS.has(t) && tokens(name)[0] === t) {
        return { base: name.trim(), section: null }; // leading direction = identity
      }
    }
  }
  return { base, section };
}

const baseKey = (base) => tokens(base).filter((t) => !GENERIC.has(t)).sort().join('|');
const km = (a, b) => {
  const R = 6371, d = Math.PI / 180;
  const x = (b.lat - a.lat) * d, y = (b.lng - a.lng) * d * Math.cos(((a.lat + b.lat) / 2) * d);
  return R * Math.hypot(x, y);
};
const titleCase = (s) => s.replace(/\p{L}+/gu, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());

// ── Club helpers ─────────────────────────────────────────────────────────────
async function ensureClub(fields) {
  let existing = [];
  try {
    existing = await rest(`golf_clubs?name=eq.${encodeURIComponent(fields.name)}&select=id&limit=1`);
  } catch (e) {
    // Pre-125 schema has no golf_clubs table — fine for a dry run.
    if (APPLY || !String(e).includes('PGRST205')) throw e;
  }
  if (existing.length) return existing[0].id;
  if (!APPLY) return `(dry-run club: ${fields.name})`;
  const created = await rest('golf_clubs', {
    method: 'POST',
    headers: { ...H, Prefer: 'return=representation' },
    body: JSON.stringify(fields),
  });
  return created[0].id;
}

async function linkRow(rowId, clubId, clubName, sectionName, sectionKind) {
  if (!APPLY) return;
  await rest(`golf_courses?id=eq.${rowId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      club_id: clubId,
      club_name: clubName, // fires the 112 search-documents trigger (subtitle)
      section_name: sectionName,
      section_kind: sectionKind,
    }),
  });
}

async function upsertSectionRow(fields) {
  if (!APPLY) { note(`would insert section row: ${fields.name}`); return; }
  await rest('golf_courses?on_conflict=external_source,external_id', {
    method: 'POST',
    headers: { ...H, Prefer: 'resolution=ignore-duplicates' },
    body: JSON.stringify(fields),
  });
  // ignore-duplicates skips the update path — PATCH the club link explicitly
  // so re-runs converge even for rows that already existed.
  await rest(
    `golf_courses?external_source=eq.${fields.external_source}&external_id=eq.${fields.external_id}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        club_id: fields.club_id,
        club_name: fields.club_name,
        section_name: fields.section_name,
        section_kind: fields.section_kind,
      }),
    }
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(APPLY ? '▸ APPLY MODE — writing links' : '▸ DRY RUN — proposing only (--apply to write)');
  const all = await fetchAllCourses();
  console.log(`▸ Catalog: ${all.length} rows`);

  // ── Phase A: sibling sweep ────────────────────────────────────────────────
  console.log('▸ Phase A — sibling groups (base name + ~2 km)');
  const byBase = new Map();
  for (const row of all) {
    const { base, section } = splitSection(row.name);
    const key = baseKey(base);
    // ≥2 informative tokens: "Riverside" alone can't identify a facility.
    if (key.split('|').filter(Boolean).length < 2) continue;
    if (!byBase.has(key)) byBase.set(key, []);
    byBase.get(key).push({ row, base, section });
  }
  let groups = 0, linked = 0;
  for (const [, members] of byBase) {
    if (members.length < 2) continue;
    // Proximity clusters within the base group (DEDUPE_BOX ≈ 2 km).
    const remaining = [...members];
    while (remaining.length) {
      const seedM = remaining.shift();
      if (typeof seedM.row.lat !== 'number' || typeof seedM.row.lng !== 'number') continue;
      const cluster = [seedM];
      for (let i = remaining.length - 1; i >= 0; i--) {
        const m = remaining[i];
        if (typeof m.row.lat !== 'number' || typeof m.row.lng !== 'number') continue;
        if (km(seedM.row, m.row) <= 2.2) {
          cluster.push(m);
          remaining.splice(i, 1);
        }
      }
      if (cluster.length < 2) continue;
      // Only a group where the names actually DIFFER by section marker (or
      // duplicate exact names across sources — those are cross-source dupes,
      // not sections; skip them: adoption already handles that class).
      if (!cluster.some((m) => m.section)) continue;
      if (cluster.every((m) => m.row.club_id)) { continue; } // already linked (re-run)
      groups++;
      const clubName = titleCase(cluster.map((m) => m.base).sort((a, b) => a.length - b.length)[0]);
      const rich = cluster.map((m) => m.row).sort((a, b) =>
        ['city', 'region', 'country', 'place_id'].filter((k) => b[k]).length -
        ['city', 'region', 'country', 'place_id'].filter((k) => a[k]).length
      )[0];
      console.log(`  ▪ ${clubName}`);
      for (const m of cluster) {
        console.log(`      - ${m.row.name} [${m.row.external_source}] holes=${m.row.holes_count ?? '?'} section=${m.section ?? '—'}${m.row.club_id ? ' (already linked)' : ''}`);
      }
      const clubId = await ensureClub({
        name: clubName,
        city: rich.city, region: rich.region, region_code: rich.region_code,
        country: rich.country, country_code: rich.country_code,
        place_id: rich.place_id,
        lat: cluster.reduce((s, m) => s + m.row.lat, 0) / cluster.length,
        lng: cluster.reduce((s, m) => s + m.row.lng, 0) / cluster.length,
      });
      for (const m of cluster) {
        if (m.row.club_id) continue;
        const kind = m.row.holes_count === 9 ? 'nine' : m.row.holes_count === 18 ? 'course_18' : 'unspecified';
        await linkRow(m.row.id, clubId, clubName, m.section ? titleCase(m.section) : null, kind);
        linked++;
      }
    }
  }
  console.log(`  groups proposed: ${groups}; rows ${APPLY ? 'linked' : 'linkable'}: ${linked}`);

  // ── Phase B: lone 27/36-hole rows (report only) ───────────────────────────
  console.log('▸ Phase B — lone rows claiming 27/36 holes (report only, never split blindly)');
  for (const row of all) {
    if ((row.holes_count === 27 || row.holes_count === 36) && !row.club_id) {
      note(`${row.name} [${row.external_source}] holes_count=${row.holes_count} — needs curation`);
    }
  }

  // ── Phase C: curation — the two named clubs ───────────────────────────────
  console.log('▸ Phase C — curation: Greensmere + Ottawa Hunt');
  // Greensmere Golf & Country Club: two 18-hole courses, Premier and Legacy.
  const greensmere = all.filter((r) => /greensmere/i.test(r.name));
  if (greensmere.length) {
    const src = greensmere[0];
    const clubId = await ensureClub({
      name: 'Greensmere Golf & Country Club',
      city: src.city, region: src.region, region_code: src.region_code,
      country: src.country, country_code: src.country_code,
      place_id: src.place_id, lat: src.lat, lng: src.lng,
    });
    for (const r of greensmere) {
      await linkRow(r.id, clubId, 'Greensmere Golf & Country Club', null, 'unspecified');
    }
    for (const section of ['Premier', 'Legacy']) {
      await upsertSectionRow({
        external_source: 'seed',
        external_id: `greensmere-${section.toLowerCase()}`,
        name: `Greensmere Golf & Country Club (${section})`,
        club_id: clubId, club_name: 'Greensmere Golf & Country Club',
        section_name: section, section_kind: 'course_18',
        holes_count: 18,
        city: src.city, region: src.region, region_code: src.region_code,
        country: src.country, country_code: src.country_code,
        lat: src.lat, lng: src.lng,
        // NO hole_data / ratings — never fabricate. OSM has zero hole ways
        // here today; the 30-day geometry retry picks it up if that changes.
      });
    }
    ok(`Greensmere: club + 2 rows linked + Premier/Legacy sections ${APPLY ? 'written' : 'proposed'}`);
  } else bad('Greensmere row not found in catalog');

  // Ottawa Hunt and Golf Club: 27 championship holes in three nines
  // (North / South / West — EYEBALL in dry-run before applying).
  const ottawaHunt = all.filter((r) => /^ottawa hunt/i.test(r.name));
  if (ottawaHunt.length) {
    const src = ottawaHunt.find((r) => r.external_source === 'opengolfapi') ?? ottawaHunt[0];
    const clubId = await ensureClub({
      name: 'Ottawa Hunt and Golf Club',
      city: src.city, region: src.region, region_code: src.region_code,
      country: src.country, country_code: src.country_code,
      place_id: src.place_id, lat: src.lat, lng: src.lng,
    });
    for (const r of ottawaHunt) {
      await linkRow(r.id, clubId, 'Ottawa Hunt and Golf Club', null, 'unspecified');
    }
    // The seed row carries a FABRICATED 18-hole scorecard for a real 27-hole
    // club — invented data is worse than none. Null it (idempotent).
    const seedRow = ottawaHunt.find((r) => r.external_source === 'seed');
    if (seedRow && APPLY) {
      await rest(`golf_courses?id=eq.${seedRow.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          hole_data: null, course_rating: {}, slope_rating: {},
          total_par: null, holes_count: null,
          hole_geometry: null, hole_geometry_at: null, // fresh shot under the split code
        }),
      });
    } else if (seedRow) {
      note(`would NULL fabricated seed scorecard on ${seedRow.id}`);
    }
    for (const section of ['North', 'South', 'West']) {
      await upsertSectionRow({
        external_source: 'seed',
        external_id: `ottawa-hunt-${section.toLowerCase()}`,
        name: `Ottawa Hunt and Golf Club (${section} Nine)`,
        club_id: clubId, club_name: 'Ottawa Hunt and Golf Club',
        section_name: `${section} Nine`, section_kind: 'nine',
        holes_count: 9,
        city: src.city, region: src.region, region_code: src.region_code,
        country: src.country, country_code: src.country_code,
        lat: src.lat, lng: src.lng,
      });
    }
    ok(`Ottawa Hunt: club + ${ottawaHunt.length} rows linked + 3 nine sections ${APPLY ? 'written' : 'proposed'}`);
  } else bad('Ottawa Hunt rows not found in catalog');

  // ── Verification ──────────────────────────────────────────────────────────
  if (APPLY) {
    console.log('▸ Verification');
    const clubs = await rest('golf_clubs?select=id,name&order=name.asc');
    ok(`golf_clubs rows: ${clubs.length}`);
    const orphans = await rest(
      'golf_courses?select=id&club_id=not.is.null&limit=1000'
    );
    ok(`club-linked course rows: ${orphans.length}`);
    for (const name of ['Greensmere Golf & Country Club', 'Ottawa Hunt and Golf Club']) {
      const club = clubs.find((c) => c.name === name);
      if (!club) { bad(`club missing: ${name}`); continue; }
      const sections = await rest(
        `golf_courses?club_id=eq.${club.id}&select=name,section_name,section_kind,holes_count&order=section_name.asc.nullslast`
      );
      ok(`${name}: ${sections.length} linked rows`);
      for (const s of sections) {
        console.log(`      - ${s.name} | section=${s.section_name ?? '—'} kind=${s.section_kind} holes=${s.holes_count ?? '—'}`);
      }
    }
    const seedCheck = await rest(
      `golf_courses?external_source=eq.seed&external_id=eq.ottawa-hunt&select=hole_data,total_par`
    );
    if (seedCheck[0] && seedCheck[0].hole_data === null && seedCheck[0].total_par === null) {
      ok('Ottawa Hunt fabricated seed scorecard is nulled');
    } else bad('Ottawa Hunt seed scorecard still carries data');
  }
  console.log(APPLY ? '\nDone (applied).' : '\nDry run complete — re-run with --apply to write.');
}

main().catch((e) => { console.error(e); process.exit(1); });
